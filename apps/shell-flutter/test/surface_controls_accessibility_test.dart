import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/main.dart';

// P2-14: controls the agent draws on a surface are as real as the shell's own, so each must be a 44px
// target at desktop, phone and enlarged text.
void main() {
  final cases = <({String name, Size size, double scale})>[
    (name: 'desktop', size: const Size(1200, 900), scale: 1),
    (name: 'phone', size: const Size(430, 900), scale: 1),
    (name: 'phone with large text', size: const Size(360, 700), scale: 2),
  ];
  for (final c in cases) {
    testWidgets('surface controls are 44px targets on ${c.name}', (
      tester,
    ) async {
      tester.view.physicalSize = c.size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.platformDispatcher.textScaleFactorTestValue = c.scale;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final client = MockClient((request) async {
        final Object data;
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
              'surface': {
                'version': '1.0.0',
                'sessionId': body['sessionId'],
                'revision': '00000000-0000-4000-8000-000000000001',
                'view': {
                  'type': 'SurfaceCard',
                  'id': 'card',
                  'children': [
                    {
                      'type': 'FormInput',
                      'id': 'plate',
                      'properties': {'name': 'plate', 'label': 'Plate number'},
                    },
                    {
                      'type': 'ChoiceGroup',
                      'id': 'source',
                      'properties': {
                        'options': [
                          {'id': 'wallet', 'title': 'Wallet'},
                          {'id': 'card', 'title': 'Card'},
                        ],
                      },
                    },
                    {
                      'type': 'Button',
                      'id': 'go',
                      'properties': {'label': 'Continue'},
                      'onEvents': [
                        {
                          'actionType': 'AGENT_ACTION_DISPATCH',
                          'payload': {'action': 'continue'},
                        },
                      ],
                    },
                  ],
                },
                'assistantMessage': {'text': 'Here is your form'},
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
        await tester.enterText(find.byType(TextField).last, 'Show form');
        await tester.tap(find.widgetWithText(ElevatedButton, 'Send'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        if (c.size.width < 900) {
          await tester.tap(find.text('Service details'));
          await tester.pumpAndSettle();
        }

        Future<void> measure(Finder target, String label) async {
          expect(target, findsWidgets, reason: '$label is drawn');
          await tester.ensureVisible(target.first);
          final size = tester.getSize(target.first);
          expect(
            size.height,
            greaterThanOrEqualTo(44),
            reason: '$label is shorter than the touch target',
          );
          expect(
            size.width,
            greaterThanOrEqualTo(44),
            reason: '$label is narrower than the touch target',
          );
        }

        await measure(
          find.widgetWithText(ElevatedButton, 'Continue'),
          'Button',
        );
        await measure(find.widgetWithText(InkWell, 'Wallet'), 'Choice Wallet');
        await measure(find.widgetWithText(InkWell, 'Card'), 'Choice Card');
        await measure(
          find.widgetWithText(TextFormField, 'Plate number'),
          'Form input',
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }
}
