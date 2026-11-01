import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/main.dart';

// P1-12: a gateway answer the shell cannot draw (a malformed surface, a wrong session, a revision that is not a revision) must never
// be drawn, must never crash the shell, and must say the answer could not be shown, not that the gateway could not be reached.
void main() {
  final bad = <String, Map<String, dynamic> Function(String sessionId)>{
    'a surface for another session': (sessionId) => {
      'version': '1.0.0',
      'sessionId': 'someone_elses_session',
      'revision': '00000000-0000-4000-8000-000000000001',
      'view': {'type': 'SurfaceCard', 'id': 'card', 'children': <Object>[]},
    },
    'a revision that is not a revision': (sessionId) => {
      'version': '1.0.0',
      'sessionId': sessionId,
      'revision': 'not-a-revision',
      'view': {'type': 'SurfaceCard', 'id': 'card', 'children': <Object>[]},
    },
    'a component with no id': (sessionId) => {
      'version': '1.0.0',
      'sessionId': sessionId,
      'revision': '00000000-0000-4000-8000-000000000001',
      'view': {
        'type': 'SurfaceCard',
        'id': 'card',
        'children': [
          {'type': 'Text'},
        ],
      },
    },
    'properties that are not an object': (sessionId) => {
      'version': '1.0.0',
      'sessionId': sessionId,
      'revision': '00000000-0000-4000-8000-000000000001',
      'view': {'type': 'SurfaceCard', 'id': 'card', 'properties': 'oops'},
    },
  };
  for (final entry in bad.entries) {
    testWidgets(
      'the shell refuses ${entry.key} without crashing or blaming the connection',
      (tester) async {
        tester.view.physicalSize = const Size(1200, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
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
                'surface': entry.value(body['sessionId'] as String),
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
          await tester.enterText(find.byType(TextField).last, 'Show something');
          await tester.tap(find.widgetWithText(ElevatedButton, 'Send'));
          await tester.pumpAndSettle();
          expect(
            find.textContaining('Could not reach Gateway'),
            findsNothing,
            reason: 'an unreadable answer is not an unreachable gateway',
          );
          expect(
            find.text('The answer could not be shown. Nothing was changed.'),
            findsOneWidget,
          );
          expect(find.textContaining('Unsupported component'), findsNothing);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
        }, () => client);
      },
    );
  }
}
