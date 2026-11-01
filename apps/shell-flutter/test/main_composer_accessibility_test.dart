import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/main.dart';

// P2-14: the composer is the control people use most, so it gets the same 44px targets, names and
// large-text reachability as the rest of the shell.
void main() {
  final cases = <({String name, Size size, double scale})>[
    (name: 'desktop', size: const Size(1200, 900), scale: 1),
    (name: 'phone', size: const Size(430, 900), scale: 1),
    (name: 'phone with large text', size: const Size(360, 700), scale: 2),
    // Flutter shrinks Material controls on desktop browsers, which the Android default hides.
    (name: 'a macOS desktop browser', size: const Size(1200, 900), scale: 1),
  ];
  for (final c in cases) {
    testWidgets('composer is a named, reachable target on ${c.name}', (
      tester,
    ) async {
      debugDefaultTargetPlatformOverride = c.name.contains('macOS')
          ? TargetPlatform.macOS
          : null;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
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

        final field = find.byType(TextField);
        expect(field, findsOneWidget);
        expect(
          tester.getSize(field).height,
          greaterThanOrEqualTo(44),
          reason: 'the message field is a 44px target',
        );
        final input = tester.widget<TextField>(field).decoration!;
        expect(
          (input.labelText ?? input.hintText ?? '').trim(),
          isNotEmpty,
          reason: 'the message field has a name for screen readers',
        );
        final send = find.widgetWithText(ElevatedButton, 'Send');
        expect(send, findsOneWidget);
        expect(tester.getSize(send).height, greaterThanOrEqualTo(44));
        expect(tester.getSize(send).width, greaterThanOrEqualTo(44));

        expect(tester.takeException(), isNull);
        debugDefaultTargetPlatformOverride = null;
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }
}
