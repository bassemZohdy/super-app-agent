import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/main.dart';

// P1-12: when a resident acts on a surface the gateway has since replaced, the gateway answers 409 STALE_SURFACE with the surface that
// is current. The shell must say so, draw the current surface instead, and send nothing else on its own.
void main() {
  testWidgets(
    'a stale action shows the gateway\'s reason and the current surface, and sends no second action',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var actions = 0;
      Map<String, dynamic> surface(
        String sessionId,
        String revision,
        String title, {
        bool withButton = false,
      }) => {
        'version': '1.0.0',
        'sessionId': sessionId,
        'revision': revision,
        'timestamp': 1793500000000,
        'view': {
          'type': 'SurfaceCard',
          'id': 'card',
          'children': [
            {
              'type': 'Heading',
              'id': 'title',
              'properties': {'text': title, 'level': 2},
            },
            if (withButton)
              {
                'type': 'Button',
                'id': 'go',
                'properties': {'label': 'Continue'},
                'onEvents': [
                  {
                    'event': 'onPress',
                    'actionType': 'AGENT_ACTION_DISPATCH',
                    'payload': {'action': 'continue'},
                  },
                ],
              },
          ],
        },
      };
      final client = MockClient((request) async {
        final Object data;
        var status = 200;
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
              ],
              'user': {'name': 'Alex Commuter'},
            };
          case '/api/a2ui/intent':
            final body = jsonDecode(request.body) as Map<String, dynamic>;
            data = {
              'success': true,
              'surface': surface(
                body['sessionId'] as String,
                '00000000-0000-4000-8000-000000000001',
                'Review before you continue',
                withButton: true,
              ),
            };
          case '/api/a2ui/action':
            actions++;
            final body = jsonDecode(request.body) as Map<String, dynamic>;
            status = 409;
            data = {
              'success': false,
              'code': 'STALE_SURFACE',
              'error': 'This surface has been replaced. Review the current surface before acting.',
              'retry': {'allowed': false, 'next': 'refresh_surface'},
              'surface': surface(
                body['sessionId'] as String,
                '00000000-0000-4000-8000-000000000002',
                'The current surface',
              ),
            };
          default:
            throw StateError('Unexpected request: ${request.url.path}');
        }
        return http.Response(
          jsonEncode(data),
          status,
          headers: {'content-type': 'application/json'},
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const SuperAppFlutter());
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField).last, 'Show something');
        await tester.tap(find.widgetWithText(ElevatedButton, 'Send'));
        await tester.pumpAndSettle();
        expect(find.text('Review before you continue'), findsOneWidget);

        await tester.tap(find.widgetWithText(ElevatedButton, 'Continue'));
        await tester.pumpAndSettle();
        expect(actions, 1, reason: 'one tap sends one action');
        expect(
          find.text(
            'This surface has been replaced. Review the current surface before acting.',
          ),
          findsOneWidget,
          reason: 'the resident is told why nothing happened',
        );
        expect(find.text('The current surface'), findsOneWidget);
        expect(find.text('Review before you continue'), findsNothing);
        expect(
          find.widgetWithText(ElevatedButton, 'Continue'),
          findsNothing,
          reason: 'the stale button is gone, so it cannot be tapped again',
        );
        await tester.pump(const Duration(seconds: 1));
        expect(actions, 1, reason: 'the shell sends nothing else on its own');
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    },
  );
}
