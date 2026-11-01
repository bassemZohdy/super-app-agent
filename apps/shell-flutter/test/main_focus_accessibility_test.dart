import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/main.dart';
import 'package:superapp_flutter/theme/tokens.g.dart';

// P2-14: a keyboard user must see where focus is. Every button in the main shell resolves the token
// focus ring while focused, and moving focus with Tab reaches the send control.
void main() {
  testWidgets('main shell buttons draw the focus ring and Tab reaches send', (
    tester,
  ) async {
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
      final theme = Theme.of(tester.element(find.byType(Scaffold).first));
      for (final entry in {
        'elevated': theme.elevatedButtonTheme.style,
        'filled': theme.filledButtonTheme.style,
        'outlined': theme.outlinedButtonTheme.style,
        'text': theme.textButtonTheme.style,
        'icon': theme.iconButtonTheme.style,
      }.entries) {
        final side = entry.value?.side?.resolve({WidgetState.focused});
        expect(side, isNotNull, reason: '${entry.key} buttons show focus');
        expect(side!.color, CitysideTokens.focusRing, reason: entry.key);
        expect(side.width, greaterThanOrEqualTo(2), reason: entry.key);
        expect(
          entry.value!.side!.resolve(<WidgetState>{}),
          isNull,
          reason: '${entry.key} buttons are unchanged when not focused',
        );
      }

      var reached = false;
      for (var i = 0; i < 60 && !reached; i++) {
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pump();
        final button = FocusManager.instance.primaryFocus?.context
            ?.findAncestorWidgetOfExactType<ElevatedButton>();
        final label = button?.child;
        reached = label is Text && label.data == 'Send';
      }
      expect(reached, isTrue, reason: 'Tab reaches the send control');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });
}
