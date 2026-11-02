import 'dart:async';
import 'dart:convert';
import 'dart:io';

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
    'SSE rejects an oversized unfinished line and cancels the source',
    () async {
      var cancelled = false;
      final source = StreamController<List<int>>(
        onCancel: () {
          cancelled = true;
        },
      );
      final frames = readCitizenFrames(source.stream)
          .toList()
          .timeout(const Duration(seconds: 3));
      source.add(List<int>.filled(262145, 120));
      await expectLater(frames, throwsFormatException);
      expect(cancelled, isTrue);
      await source.close();
    },
  );

  test(
    'SSE bounds accumulated lines while allowing many small events',
    () async {
      final large = 'data: ${'x' * 140000}\ndata: ${'x' * 140000}\n\n';
      await expectLater(
        readCitizenFrames(Stream.value(utf8.encode(large))).toList(),
        throwsFormatException,
      );
      final many = 'data: {"sessionId":"session1"}\n\n' * 1000;
      final frames = await readCitizenFrames(Stream.value(utf8.encode(many)))
          .toList();
      expect(frames, hasLength(1000));
      expect(
        frames.every((frame) => frame.envelope['sessionId'] == 'session1'),
        isTrue,
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

  test('closing during authorization finishes promptly without connecting', () async {
    for (final reject in [false, true]) {
      final authorization = Completer<String>();
      final started = Completer<void>();
      var calls = 0;
      final client = MockClient((_) async { calls++; return http.Response('{}', 401); });
      final stream = CitizenEventStream(
        url: Uri.parse('http://localhost/stream'), sessionId: 'session1',
        authorization: () { started.complete(); return authorization.future; },
        onStatus: (_) {}, onAuthRequired: () => fail('Unexpected auth rejection'),
        onEnvelope: (_) => fail('Unexpected message'),
      );
      await http.runWithClient(() async {
        final running = stream.run();
        await started.future;
        stream.close();
        await running.timeout(const Duration(seconds: 2));
        if (reject) { authorization.completeError(StateError('late authorization failure')); }
        else { authorization.complete('Bearer late'); }
        await Future<void>.delayed(Duration.zero);
        expect(calls, 0);
      }, () => client);
    }
  });

  test('closing in the connecting callback never starts authorization', () async {
    var tokens = 0;
    late CitizenEventStream stream;
    stream = CitizenEventStream(
      url: Uri.parse('http://localhost/stream'), sessionId: 'session1',
      authorization: () async { tokens++; return 'Bearer token'; },
      onStatus: (_) => stream.close(), onAuthRequired: () => fail('Unexpected auth rejection'),
      onEnvelope: (_) => fail('Unexpected message'),
    );
    await stream.run().timeout(const Duration(seconds: 2));
    expect(tokens, 0);
  });

  test('closing while an HTTP response is pending returns without waiting', () async {
    final started = Completer<void>();
    final response = Completer<http.StreamedResponse>();
    final client = MockClient.streaming((_, __) { started.complete(); return response.future; });
    final stream = CitizenEventStream(
      url: Uri.parse('http://localhost/stream'), sessionId: 'session1',
      authorization: () async => 'Bearer token', onStatus: (_) {},
      onAuthRequired: () => fail('Unexpected auth rejection'), onEnvelope: (_) => fail('Unexpected event'),
    );
    await http.runWithClient(() async {
      final running = stream.run();
      await started.future;
      stream.close();
      await running.timeout(const Duration(seconds: 2));
      response.completeError(StateError('late network failure'));
      await Future<void>.delayed(Duration.zero);
    }, () => client);
  });

  test('a response arriving after closure has its body cancelled', () async {
    final started = Completer<void>();
    final response = Completer<http.StreamedResponse>();
    var cancelled = false;
    final body = StreamController<List<int>>(onCancel: () { cancelled = true; });
    final client = MockClient.streaming((_, __) { started.complete(); return response.future; });
    final stream = CitizenEventStream(
      url: Uri.parse('http://localhost/stream'), sessionId: 'session1',
      authorization: () async => 'Bearer token', onStatus: (_) {},
      onAuthRequired: () => fail('Unexpected auth rejection'), onEnvelope: (_) => fail('Unexpected event'),
    );
    await http.runWithClient(() async {
      final running = stream.run();
      await started.future;
      stream.close();
      await running.timeout(const Duration(seconds: 2));
      response.complete(http.StreamedResponse(body.stream, 200, headers: {'content-type': 'text/event-stream'}));
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(cancelled, isTrue);
      await body.close();
    }, () => client);
  });

  test('closing in connected status cancels the body without listening for events', () async {
    var cancelled = false;
    final body = StreamController<List<int>>(onCancel: () { cancelled = true; });
    final client = MockClient.streaming((_, __) async => http.StreamedResponse(body.stream, 200, headers: {'content-type': 'text/event-stream'}));
    late CitizenEventStream stream;
    stream = CitizenEventStream(
      url: Uri.parse('http://localhost/stream'), sessionId: 'session1',
      authorization: () async => 'Bearer token', onStatus: (status) { if (status == 'Live updates connected') stream.close(); },
      onAuthRequired: () => fail('Unexpected auth rejection'), onEnvelope: (_) => fail('Unexpected event'),
    );
    await http.runWithClient(() => stream.run().timeout(const Duration(seconds: 2)), () => client);
    expect(cancelled, isTrue);
    await body.close();
  });

  test('closing a silent stream returns and cancels its subscription', () async {
    final connected = Completer<void>();
    var cancelled = false;
    final source = StreamController<List<int>>(onCancel: () { cancelled = true; return Completer<void>().future; });
    final client = MockClient.streaming((_, __) async => http.StreamedResponse(source.stream, 200, headers: {'content-type': 'text/event-stream'}));
    final stream = CitizenEventStream(
      url: Uri.parse('http://localhost/stream'), sessionId: 'session1',
      authorization: () async => 'Bearer token', onStatus: (status) { if (status == 'Live updates connected') connected.complete(); },
      onAuthRequired: () => fail('Unexpected auth rejection'), onEnvelope: (_) => fail('Unexpected event'),
    );
    await http.runWithClient(() async {
      final running = stream.run();
      await connected.future;
      await Future<void>.delayed(Duration.zero);
      stream.close();
      await running.timeout(const Duration(seconds: 2));
      expect(cancelled, isTrue);
    }, () => client);
  });

  test('closing from the reconnect status does not start a delay', () async {
    final client = MockClient((_) async => http.Response('', 409));
    late CitizenEventStream stream;
    stream = CitizenEventStream(
      url: Uri.parse('http://localhost/stream'), sessionId: 'session1',
      authorization: () async => 'Bearer token', onStatus: (status) { if (status.startsWith('Reconnecting')) stream.close(); },
      onAuthRequired: () => fail('Unexpected auth rejection'), onEnvelope: (_) => fail('Unexpected event'),
    );
    await http.runWithClient(() => stream.run().timeout(const Duration(milliseconds: 200)), () => client);
  });

  test('stream requests disable redirects and discard redirect bodies', () async {
    bool? follows;
    var cancelled = false;
    final body = StreamController<List<int>>(onCancel: () { cancelled = true; });
    final client = MockClient.streaming((request, _) async {
      follows = request.followRedirects;
      return http.StreamedResponse(body.stream, 302, headers: {'location': 'http://other.example/stream'});
    });
    late CitizenEventStream stream;
    stream = CitizenEventStream(
      url: Uri.parse('http://localhost/stream'), sessionId: 'session1',
      authorization: () async => 'Bearer token',
      onStatus: (status) { if (status.startsWith('Reconnecting')) stream.close(); },
      onAuthRequired: () => fail('Unexpected auth rejection'), onEnvelope: (_) => fail('Unexpected event'),
    );
    await http.runWithClient(() => stream.run().timeout(const Duration(seconds: 2)), () => client);
    expect(follows, isFalse);
    expect(cancelled, isTrue);
    await body.close();
  });

  test('a real redirect never reaches the redirected server', () async {
    final target = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final origin = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var redirectedRequests = 0, originRequests = 0;
    target.listen((request) { redirectedRequests++; request.response.close(); });
    origin.listen((request) {
      originRequests++;
      expect(request.headers.value('authorization'), 'Bearer token');
      request.response.statusCode = 302;
      request.response.headers.set('location', 'http://127.0.0.1:${target.port}/stream');
      request.response.close();
    });
    late CitizenEventStream stream;
    stream = CitizenEventStream(
      url: Uri.parse('http://127.0.0.1:${origin.port}/stream'), sessionId: 'session1',
      authorization: () async => 'Bearer token',
      onStatus: (status) { if (status.startsWith('Reconnecting')) stream.close(); },
      onAuthRequired: () => fail('Unexpected auth rejection'), onEnvelope: (_) => fail('Unexpected event'),
    );
    try {
      await stream.run().timeout(const Duration(seconds: 5));
      expect(originRequests, 1);
      expect(redirectedRequests, 0);
    } finally {
      await origin.close(force: true);
      await target.close(force: true);
    }
  });

  test('a non-event-stream success is discarded without delivering its content', () async {
    var cancelled = false;
    final body = StreamController<List<int>>(onListen: () {}, onCancel: () { cancelled = true; });
    final delivered = <Map<String, dynamic>>[];
    final client = MockClient.streaming((_, __) async => http.StreamedResponse(body.stream, 200, headers: {'content-type': 'application/json'}));
    late CitizenEventStream stream;
    stream = CitizenEventStream(
      url: Uri.parse('http://localhost/stream'), sessionId: 'session1',
      authorization: () async => 'Bearer token',
      onStatus: (status) { if (status == 'Live updates connected') body.add(utf8.encode('data: {"sessionId":"session1"}\n\n')); if (status.startsWith('Reconnecting')) stream.close(); },
      onAuthRequired: () => fail('Unexpected auth rejection'), onEnvelope: delivered.add,
    );
    await http.runWithClient(() => stream.run().timeout(const Duration(seconds: 2)), () => client);
    expect(delivered, isEmpty);
    expect(cancelled, isTrue);
    await body.close();
  });

  test('unsafe cursors request a fresh snapshot after readable and unreadable events', () async {
    for (final cursor in [
      'x' * 129,
      'unicode-م',
      'bad\u0000id',
      'bad\tid',
      '',
      '<bare>',
    ]) {
      for (final readable in [true, false]) {
        final resumedFrom = <String?>[];
        final messages = <int>[];
        late CitizenEventStream stream;
        final client = MockClient((request) async {
          resumedFrom.add(request.headers['Last-Event-ID']);
          if (resumedFrom.length == 1) {
            final payload = readable
                ? '{"sessionId":"session1","n":2}'
                : '{invalid';
            final idField = cursor == '<bare>' ? 'id' : 'id: $cursor';
            return http.Response(
              'id: good-1\ndata: {"sessionId":"session1","n":1}\n\n$idField\ndata: $payload\n\n',
              200,
              headers: {'content-type': 'text/event-stream; charset=utf-8'},
            );
          }
          return http.Response('data: {"sessionId":"session1","n":3}\n\n', 200, headers: {'content-type': 'text/event-stream'});
        });
        stream = CitizenEventStream(
          url: Uri.parse('http://localhost/stream'),
          sessionId: 'session1',
          authorization: () async => 'Bearer token',
          onStatus: (_) {},
          onAuthRequired: () => fail('Unexpected auth rejection'),
          onEnvelope: (envelope) {
            messages.add(envelope['n'] as int);
            if (envelope['n'] == 3) stream.close();
          },
        );
        await http.runWithClient(
          () => stream.run().timeout(const Duration(seconds: 8)),
          () => client,
        );
        expect(resumedFrom, [
          null,
          null,
        ], reason: 'unsafe cursor must clear stale replay state');
        expect(messages, readable ? [1, 2, 3] : [1, 3]);
      }
    }
  });

  test('a failed handler retains the previous cursor even if the new one is unsafe', () async {
    final resumedFrom = <String?>[];
    late CitizenEventStream stream;
    var failed = false;
    final client = MockClient((request) async {
      resumedFrom.add(request.headers['Last-Event-ID']);
      if (resumedFrom.length == 1) {
        return http.Response(
          'id: good-1\ndata: {"sessionId":"session1","n":1}\n\nid: bad\tid\ndata: {"sessionId":"session1","n":2}\n\n',
          200,
          headers: {'content-type': 'text/event-stream'},
        );
      }
      return http.Response('data: {"sessionId":"session1","n":3}\n\n', 200, headers: {'content-type': 'text/event-stream'});
    });
    stream = CitizenEventStream(
      url: Uri.parse('http://localhost/stream'),
      sessionId: 'session1',
      authorization: () async => 'Bearer token',
      onStatus: (_) {},
      onAuthRequired: () => fail('Unexpected auth rejection'),
      onEnvelope: (envelope) {
        if (envelope['n'] == 2 && !failed) {
          failed = true;
          throw StateError('handler failed');
        }
        if (envelope['n'] == 3) stream.close();
      },
    );
    await http.runWithClient(
      () => stream.run().timeout(const Duration(seconds: 8)),
      () => client,
    );
    expect(resumedFrom, [null, 'good-1']);
  });

  test('a handler failure replays the unhandled event after reconnect', () async {
    final resumedFrom = <String?>[];
    final attempts = <int>[];
    late CitizenEventStream stream;
    var failed = false;
    final client = MockClient((request) async {
      final from = request.headers['Last-Event-ID'];
      resumedFrom.add(from);
      final body = StringBuffer();
      for (var id = 1; id <= 3; id++) {
        if (from == null || id > int.parse(from)) {
          body.write('id: $id\ndata: {"sessionId":"session1","n":$id}\n\n');
        }
      }
      return http.Response(
        body.toString(),
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    });
    stream = CitizenEventStream(
      url: Uri.parse('http://localhost/stream'),
      sessionId: 'session1',
      authorization: () async => 'Bearer token',
      onStatus: (_) {},
      onAuthRequired: () => fail('Unexpected auth rejection'),
      onEnvelope: (envelope) {
        final n = envelope['n'] as int;
        attempts.add(n);
        if (n == 2 && !failed) {
          failed = true;
          throw StateError('handler failed');
        }
        if (n == 3) stream.close();
      },
    );
    await http.runWithClient(
      () => stream.run().timeout(const Duration(seconds: 8)),
      () => client,
    );
    expect(resumedFrom, [null, '1']);
    expect(attempts, [1, 2, 2, 3]);
  });
}
