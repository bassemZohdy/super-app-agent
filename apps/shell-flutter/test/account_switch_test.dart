import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/main.dart';

void main() {
  for (final size in [const Size(1200, 900), const Size(430, 900)]) {
    testWidgets('account switching clears the previous conversation at $size', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final intents = <Map<String, dynamic>>[];
      final client = MockClient((request) async {
        Object data;
        switch (request.url.path) {
          case '/health':
            data = {
              'llm': {'enabled': false},
            };
          case '/api/auth/config':
            data = {'enabled': false};
          case '/api/accounts':
            data = {
              'accounts': [
                {'id': 'personal', 'label': 'Personal account'},
                {'id': 'household', 'label': 'Household account'},
              ],
              'user': {'name': 'Alex Commuter'},
            };
          case '/api/a2ui/intent':
            final body = jsonDecode(request.body) as Map<String, dynamic>;
            intents.add(body);
            data = {
              'success': true,
              'surface': {
                'version': '1.0.0',
                'sessionId': body['sessionId'],
                'revision': '00000000-0000-4000-8000-000000000001',
                'view': {
                  'type': 'SurfaceCard',
                  'id': 'wallet',
                  'children': <Object>[],
                },
                'assistantMessage': {'text': 'Personal account wallet reply'},
              },
            };
          case '/api/sessions':
            data = {
              'sessions': [
                {
                  'sessionId': 'saved_session',
                  'accountId': 'household',
                  'title': 'Saved household chat',
                },
              ],
            };
          case '/api/sessions/saved_session':
            data = {
              'messages': [
                {'role': 'user', 'content': 'Earlier question'},
                {'role': 'assistant', 'content': 'Saved final reply'},
              ],
              'surface': {
                'version': '1.0.0',
                'sessionId': 'saved_session',
                'revision': '00000000-0000-4000-8000-000000000002',
                'view': {
                  'type': 'SurfaceCard',
                  'id': 'saved',
                  'children': <Object>[],
                },
              },
            };
          default:
            throw StateError('Unexpected request: ${request.url.path}');
        }
        return http.Response(
          jsonEncode(data),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const SuperAppFlutter());
        await tester.pumpAndSettle();
        expect(find.byType(DropdownButton<String>), findsOneWidget);
        await tester.enterText(find.byType(TextField), 'Show my wallet');
        await tester.tap(find.text('Send'));
        await tester.pumpAndSettle();
        expect(find.text('Personal account wallet reply'), findsOneWidget);
        await tester.tap(find.byType(DropdownButton<String>));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Household account').last);
        await tester.pumpAndSettle();
        expect(find.text('Personal account wallet reply'), findsNothing);
        await tester.enterText(find.byType(TextField), 'Show household wallet');
        await tester.tap(find.text('Send'));
        await tester.pumpAndSettle();
        expect(intents.map((body) => body['accountId']), [
          'personal',
          'household',
        ]);
        expect(intents[0]['sessionId'], isNot(intents[1]['sessionId']));
        await tester.tap(find.byTooltip('Saved conversations'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Saved household chat'));
        await tester.pumpAndSettle();
        expect(find.text('Earlier question'), findsOneWidget);
        expect(find.text('Saved final reply'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }
}
