import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/connections_panel.dart';
import 'package:superapp_flutter/shared/locale.dart';
import 'package:superapp_flutter/theme/tokens.g.dart';

void main() {
  for (final locale in ['en', 'ar']) {
    testWidgets('connections controls work at large text in $locale', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 520);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var refreshes = 0;
      var requests = 0;
      final client = MockClient((request) async {
        requests++;
        if (request.url.queryParameters['refresh'] == '1') refreshes++;
        return http.Response(
          jsonEncode({
            'providers': [
              {
                'provider': 'Simulator',
                'ok': true,
                'operations': [
                  {'operationId': 'list', 'method': 'GET', 'path': '/items'},
                ],
              },
            ],
            'calls': <Object>[],
          }),
          200,
        );
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(
              brightness: locale == 'ar' ? Brightness.dark : Brightness.light,
            ),
            home: MediaQuery(
              data: const MediaQueryData(
                size: Size(320, 520),
                textScaler: TextScaler.linear(2),
                disableAnimations: true,
              ),
              child: ConnectionsPanel(
                gateway: 'http://localhost',
                authorization: () async => 'test-authorization',
                locale: locale,
              ),
            ),
          ),
        );
        for (var i = 0; i < 20 && requests == 0; i++) {
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 10)),
          );
          await tester.pump(const Duration(milliseconds: 50));
        }
        expect(tester.takeException(), isNull);
        final label = citysideText(locale, 'connections.check');
        final button = find.widgetWithText(FilledButton, label);
        await tester.scrollUntilVisible(
          button,
          100,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.pump();
        expect(tester.getSize(button).height, greaterThanOrEqualTo(44));
        expect(tester.getSize(button).width, greaterThanOrEqualTo(44));
        Focus.of(tester.element(find.text(label))).requestFocus();
        await tester.pump();
        final border = tester.widget<FilledButton>(button).style!.side!.resolve(
          {WidgetState.focused},
        )!;
        expect(
          border.color,
          locale == 'ar'
              ? CitysideTokens.darkFocusRing
              : CitysideTokens.focusRing,
        );
        expect(border.width, greaterThanOrEqualTo(2));
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        for (var i = 0; i < 20 && refreshes == 0; i++) {
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 10)),
          );
          await tester.pump(const Duration(milliseconds: 50));
        }
        expect(refreshes, 1);
        await tester.scrollUntilVisible(
          find.text('Simulator'),
          100,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.pump();
        await tester.tap(find.text('Simulator'));
        await tester.pumpAndSettle();
        expect(find.text('list'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }
}
