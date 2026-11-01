import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/main.dart';

// P2-14: the main concierge header is where every tool lives, so each of its controls must be a
// real touch target with an accessible name at desktop and phone widths and at large text.
void main() {
  final cases = <({String name, Size size, double scale})>[
    (name: 'desktop', size: const Size(1200, 900), scale: 1),
    (name: 'phone', size: const Size(430, 900), scale: 1),
    (name: 'phone with large text', size: const Size(360, 700), scale: 2),
  ];
  for (final c in cases) {
    testWidgets('main header controls are named touch targets on ${c.name}', (
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
        final buttons = find.descendant(
          of: find.byType(AppBar),
          matching: find.byWidgetPredicate(
            (w) => w is IconButton || w is PopupMenuButton,
          ),
        );
        expect(buttons, findsWidgets, reason: 'the header exposes its tools');
        const minimum = 44.0;
        for (final element in buttons.evaluate()) {
          final widget = element.widget;
          final tooltip = widget is IconButton
              ? widget.tooltip
              : (widget as PopupMenuButton).tooltip;
          expect(
            tooltip,
            isNotNull,
            reason:
                'a header control without a name is unusable by screen reader',
          );
          expect(tooltip!.trim(), isNotEmpty);
          final box = element.renderObject! as RenderBox;
          expect(
            box.size.width,
            greaterThanOrEqualTo(minimum),
            reason: '$tooltip is narrower than the touch target',
          );
          expect(
            box.size.height,
            greaterThanOrEqualTo(minimum),
            reason: '$tooltip is shorter than the touch target',
          );
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }
}
