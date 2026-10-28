import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/delegation_panel.dart';
import 'package:superapp_flutter/theme/tokens.g.dart';

void main() {
  for (final dark in [false, true]) {
    testWidgets(
      'delegation controls are reachable with large text in ${dark ? 'dark' : 'light'} mode',
      (tester) async {
        tester.view.physicalSize = const Size(320, 520);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        var revoked = false, mutations = 0;
        final grant = {
          'id': 'grant-one',
          'accountId': 'selected-account',
          'purpose': 'Check this account balance',
          'used': 0,
          'maxOperations': 3,
          'expiresAt': DateTime.now()
              .add(const Duration(minutes: 5))
              .millisecondsSinceEpoch,
        };
        final client = MockClient((request) async {
          if (request.method == 'DELETE') {
            expect(request.url.path, '/api/delegation/grants/grant-one');
            mutations++;
            revoked = true;
          } else if (request.method != 'GET') {
            mutations++;
          }
          return http.Response(
            jsonEncode({
              'grants': [
                {...grant, if (revoked) 'revokedAt': 1},
              ],
            }),
            200,
          );
        });
        await http.runWithClient(() async {
          await tester.pumpWidget(
            MaterialApp(
              theme: ThemeData(
                brightness: dark ? Brightness.dark : Brightness.light,
              ),
              home: MediaQuery(
                data: const MediaQueryData(
                  size: Size(320, 520),
                  textScaler: TextScaler.linear(2),
                  disableAnimations: true,
                ),
                child: DelegationPanel(
                  gateway: 'http://demo',
                  accountId: 'selected-account',
                  authorization: () async => 'Bearer test-token',
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          for (final label in [
            'Allow up to 3 wallet balance checks',
            'Approve one AED 1 demo wallet credit',
            'Run approved operation',
            'Revoke consent',
            'View audit history',
          ]) {
            await tester.scrollUntilVisible(
              find.text(label),
              100,
              scrollable: find.byType(Scrollable).first,
            );
            final button = find
                .ancestor(
                  of: find.text(label),
                  matching: find.byWidgetPredicate(
                    (widget) => widget is ButtonStyleButton,
                  ),
                )
                .first;
            await Scrollable.ensureVisible(
              tester.element(button),
              alignment: .5,
            );
            await tester.pump();
            expect(button.hitTestable(), findsOneWidget, reason: label);
            final size = tester.getSize(button);
            expect(size.width, greaterThanOrEqualTo(44), reason: label);
            expect(size.height, greaterThanOrEqualTo(44), reason: label);
            final style = tester.widget<ButtonStyleButton>(button).style!;
            final border = style.side!.resolve({WidgetState.focused})!;
            expect(
              border.color,
              dark ? CitysideTokens.darkFocusRing : CitysideTokens.focusRing,
              reason: label,
            );
            expect(border.width, greaterThanOrEqualTo(2), reason: label);
          }
          expect(mutations, 0);
          await tester.scrollUntilVisible(
            find.text('Revoke consent'),
            -100,
            scrollable: find.byType(Scrollable).first,
          );
          await tester.ensureVisible(find.text('Revoke consent'));
          await tester.pump();
          await tester.tap(find.text('Revoke consent'));
          await tester.pumpAndSettle();
          expect(mutations, 1);
          await tester.scrollUntilVisible(
            find.text('Run approved operation'),
            -100,
            scrollable: find.byType(Scrollable).first,
          );
          expect(
            tester
                .widget<TextButton>(
                  find.widgetWithText(TextButton, 'Run approved operation'),
                )
                .onPressed,
            isNull,
          );
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
        }, () => client);
      },
    );
  }
}
