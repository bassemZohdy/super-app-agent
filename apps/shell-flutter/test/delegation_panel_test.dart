import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/delegation_panel.dart';

void main() {
  testWidgets(
    'consent is explicit, execution is separate, and withdrawal disables execution',
    (tester) async {
      final grants = <Map<String, dynamic>>[];
      var executions = 0;
      final client = MockClient((request) async {
        expect(
          request.headers['Authorization'] ?? request.headers['authorization'],
          'Bearer widget-test-token',
        );
        Object data;
        if (request.url.path.endsWith('/execute')) {
          executions++;
          grants.single['used'] = 1;
          data = {
            'success': true,
            'result': {'success': true, 'balance': 1500},
          };
        } else if (request.method == 'DELETE') {
          grants.single['revokedAt'] = DateTime.now().millisecondsSinceEpoch;
          data = {'success': true};
        } else if (request.method == 'POST') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          expect(body['accountId'], 'selected-account');
          expect(body['method'], 'GET');
          expect(body['path'], '/wallet');
          expect(body['body'], isEmpty);
          expect(body['maxOperations'], 3);
          expect(body.containsKey('sub'), isFalse);
          grants.add({
            ...body,
            'id': 'grant-test',
            'used': 0,
            'expiresAt': DateTime.now()
                .add(const Duration(minutes: 5))
                .millisecondsSinceEpoch,
          });
          data = {'success': true, 'grant': grants.single};
        } else {
          data = {'success': true, 'grants': grants};
        }
        return http.Response(
          jsonEncode(data),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: DelegationPanel(
              gateway: 'http://demo',
              accountId: 'selected-account',
              authorization: () async => 'Bearer widget-test-token',
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(grants, isEmpty);
        await tester.tap(find.text('Allow up to 3 wallet balance checks'));
        await tester.pumpAndSettle();
        expect(executions, 0);
        await tester.ensureVisible(find.text('Run approved operation'));
        await tester.tap(find.text('Run approved operation'));
        await tester.pumpAndSettle();
        expect(executions, 1);
        expect(
          find.textContaining('Wallet balance: AED 1500.00'),
          findsOneWidget,
        );
        await tester.ensureVisible(find.text('Revoke consent'));
        await tester.tap(find.text('Revoke consent'));
        await tester.pumpAndSettle();
        final run = tester.widget<TextButton>(
          find.widgetWithText(TextButton, 'Run approved operation'),
        );
        expect(run.onPressed, isNull);
        expect(executions, 1);
      }, () => client);
    },
  );
}
