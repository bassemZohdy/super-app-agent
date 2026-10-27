import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/focused_client.dart';

void main() {
  const id = '00000000-0000-4000-8000-000000000001';
  final value = <String, dynamic>{
    'threadId': id,
    'uiContract': 'cityside-compat-v1',
    'status': 'complete',
    'reply': 'Fines found',
    'messages': <Object>[],
    'next': <String>[],
    'fines': <Object>[],
    'approval': null,
    'receipt': null,
    'renewalApproval': null,
    'renewal': null,
    'surface': {
      'sessionId': id,
      'view': {'type': 'SurfaceCard', 'id': 'fines'},
    },
  };
  test(
    'focused Flutter refuses cross-owner replies and invalid minor-unit money',
    () async {
      for (final bad in [
        <String, dynamic>{...value, 'threadId': 'another-owner'},
        <String, dynamic>{
          ...value,
          'fines': [
            {'id': 'fine-1', 'description': 'Fine', 'amountMinor': 1.5},
          ],
        },
        <String, dynamic>{
          ...value,
          'receipt': {
            'id': id,
            'simulated': false,
            'quote': {'amountMinor': 100, 'currency': 'AED'},
          },
        },
      ]) {
        final client = FocusedClient(
          'synthetic-test-token',
          client: MockClient(
            (request) async => http.Response(jsonEncode(bad), 200),
          ),
        );
        await expectLater(client.inspect(id), throwsFormatException);
        client.close();
      }
    },
  );
  test('a lost or refused mutation is attempted once with its identity and no redirect', () async {
    var calls = 0;
    final client = FocusedClient(
      'synthetic-test-token',
      client: MockClient((request) async {
        calls++;
        expect(request.followRedirects, isFalse);
        expect(request.headers['Authorization'], 'Bearer synthetic-test-token');
        expect(request.headers['Idempotency-Key'], isNotEmpty);
        return http.Response('private upstream detail', 503);
      }),
    );
    await expectLater(
      client.transition(id, 'resume', {
        'approvalId': id,
        'decision': 'approve',
      }),
      throwsFormatException,
    );
    expect(calls, 1);
    client.close();
  });
}
