import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/event_stream.dart';

void main() {
  test(
    'SSE parses multiline JSON and UTF-8 split between every byte',
    () async {
      final bytes = utf8.encode(
        'id: cursor1\r\ndata: {"sessionId":"session1",\r\ndata: "data":{"text":"مرحبا"}}\r\n\r\n',
      );
      final frames = await readCitizenFrames(
        Stream.fromIterable(bytes.map((byte) => [byte])),
      ).toList();
      expect(frames.single.id, 'cursor1');
      expect(
        (frames.single.envelope['data'] as Map<String, dynamic>)['text'],
        'مرحبا',
      );
      await expectLater(
        readCitizenFrames(
          Stream.value(utf8.encode('data: ${'x' * 262145}\n\n')),
        ).toList(),
        throwsFormatException,
      );
    },
  );

  test(
    'SSE resets a stale cursor, obtains fresh headers and stops on close',
    () async {
      var calls = 0, tokens = 0;
      late CitizenEventStream stream;
      final messages = <Map<String, dynamic>>[];
      final client = MockClient((request) async {
        calls++;
        expect(request.url.queryParameters.containsKey('token'), isFalse);
        expect(
          request.headers['authorization'],
          'Bearer refreshed-${++tokens}',
        );
        if (calls == 1) return http.Response('{}', 409);
        return http.Response(
          'id: cursor2\ndata: {"sessionId":"session1","data":{}}\n\n',
          200,
          headers: {'content-type': 'text/event-stream'},
        );
      });
      stream = CitizenEventStream(
        url: Uri.parse('http://localhost/stream?sessionId=session1'),
        sessionId: 'session1',
        authorization: () async => 'Bearer refreshed-${tokens + 1}',
        onStatus: (_) {},
        onAuthRequired: () => fail('Unexpected auth rejection'),
        onEnvelope: (envelope) {
          messages.add(envelope);
          stream.close();
        },
      );
      await http.runWithClient(stream.run, () => client);
      expect(calls, 2);
      expect(messages, hasLength(1));
    },
  );

  test(
    'SSE stops on authentication rejection without a reconnect loop',
    () async {
      var calls = 0;
      var login = false;
      final client = MockClient((_) async {
        calls++;
        return http.Response('{}', 401);
      });
      final stream = CitizenEventStream(
        url: Uri.parse('http://localhost/stream'),
        sessionId: 'session1',
        authorization: () async => 'Bearer expired',
        onStatus: (_) {},
        onAuthRequired: () => login = true,
        onEnvelope: (_) => fail('Unauthorized data received'),
      );
      await http.runWithClient(stream.run, () => client);
      expect(login, isTrue);
      expect(calls, 1);
    },
  );

  test('an unreadable or foreign event is skipped, the cursor moves past it and the events after it arrive', () async {
    final resumedFrom = <String?>[];
    final messages = <int>[];
    late CitizenEventStream stream;
    final client = MockClient((request) async {
      final from = request.headers['Last-Event-ID'];
      resumedFrom.add(from);
      const events = <int, String>{
        1: '{"sessionId":"session1","n":1}',
        2: '{ this is not json',
        3: '{"sessionId":"someone_elses","n":3}',
        4: '{"sessionId":"session1","n":4}',
      };
      final body = StringBuffer();
      events.forEach((id, data) {
        if (from == null || id > int.parse(from)) {
          body.write('id: $id\ndata: $data\n\n');
        }
      });
      return http.Response(
        body.toString(),
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    });
    stream = CitizenEventStream(
      url: Uri.parse('http://localhost/stream?sessionId=session1'),
      sessionId: 'session1',
      authorization: () async => 'Bearer token',
      onStatus: (_) {},
      onAuthRequired: () => fail('Unexpected auth rejection'),
      onEnvelope: (envelope) {
        messages.add(envelope['n'] as int);
        if (envelope['n'] == 4) stream.close();
      },
    );
    await http.runWithClient(
      () => stream.run().timeout(const Duration(seconds: 8)),
      () => client,
    );
    expect(messages, [1, 4], reason: 'good events arrive once each');
    expect(
      resumedFrom.length,
      lessThanOrEqualTo(3),
      reason: 'a bad event does not make the stream replay it forever',
    );
  });
}
