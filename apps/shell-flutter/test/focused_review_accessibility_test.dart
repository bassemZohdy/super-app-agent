import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/focused_workspace.dart';
import 'package:superapp_flutter/theme/tokens.g.dart';

void main() {
  for (final largeText in [false, true]) {
    testWidgets(
      'focused payment review remains usable with ${largeText ? 'large' : 'standard'} text',
      (tester) async {
        const thread = '00000000-0000-4000-8000-000000000001';
        const approval = 'review-example';
        tester.view.physicalSize = const Size(320, 640);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final decisions = <Map<String, dynamic>>[];
        final review = {
          'threadId': thread,
          'uiContract': 'cityside-compat-v1',
          'status': 'awaiting_approval',
          'reply': '',
          'messages': <Object>[],
          'next': <String>[],
          'surface': {
            'sessionId': thread,
            'revision': approval,
            'view': <String, dynamic>{},
          },
          'approval': {
            'id': approval,
            'expiresAt': 2000000000000,
            'quote': {
              'amountMinor': 45000,
              'currency': 'AED',
              'fineIds': ['fine-1'],
            },
          },
          'fines': [
            {
              'id': 'fine-1',
              'description': 'A simulated fine',
              'amountMinor': 45000,
            },
          ],
        };
        final client = MockClient((request) async {
          if (request.url.path.endsWith('/resume')) {
            decisions.add(jsonDecode(request.body) as Map<String, dynamic>);
          }
          return http.Response(
            jsonEncode(
              request.url.path.endsWith('/threads')
                  ? {'threadId': thread}
                  : review,
            ),
            200,
          );
        });
        await http.runWithClient(() async {
          await tester.pumpWidget(
            MaterialApp(
              theme: ThemeData(
                brightness: largeText ? Brightness.dark : Brightness.light,
              ),
              home: MediaQuery(
                data: MediaQueryData(
                  size: const Size(320, 640),
                  textScaler: TextScaler.linear(largeText ? 2 : 1),
                  disableAnimations: true,
                ),
                child: const FocusedWorkspace(),
              ),
            ),
          );
          await tester.enterText(find.byType(TextField), 'test-token');
          await tester.ensureVisible(find.text('Open my fines'));
          await tester.pump();
          await tester.tap(find.text('Open my fines'));
          for (
            var i = 0;
            i < 30 && find.text('Service details').evaluate().isEmpty;
            i++
          ) {
            await tester.runAsync(
              () => Future<void>.delayed(const Duration(milliseconds: 10)),
            );
            await tester.pump(const Duration(milliseconds: 50));
          }
          await tester.tap(find.text('Service details').first);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(decisions, isEmpty);
          final detailScroll = find
              .descendant(
                of: find.byKey(const ValueKey('service details')),
                matching: find.byType(Scrollable),
              )
              .first;
          await tester.scrollUntilVisible(
            find.text('Simulated total: AED 450.00'),
            100,
            scrollable: detailScroll,
          );
          expect(find.text('Simulated total: AED 450.00'), findsOneWidget);
          for (final label in [
            'Confirm simulated payment',
            'Reject payment',
            'Cancel review',
          ]) {
            await tester.scrollUntilVisible(
              find.text(label),
              100,
              scrollable: detailScroll,
            );
            final button = find
                .ancestor(
                  of: find.text(label),
                  matching: find.byWidgetPredicate(
                    (widget) => widget is ButtonStyleButton,
                  ),
                )
                .first;
            final size = tester.getSize(button);
            expect(size.width, greaterThanOrEqualTo(44), reason: label);
            expect(size.height, greaterThanOrEqualTo(44), reason: label);
            await Scrollable.ensureVisible(
              tester.element(button),
              alignment: .5,
            );
            await tester.pump();
            expect(button.hitTestable(), findsOneWidget, reason: label);
          }
          await tester.scrollUntilVisible(
            find.text('Confirm simulated payment'),
            -100,
            scrollable: detailScroll,
          );
          final confirm = find.widgetWithText(
            FilledButton,
            'Confirm simulated payment',
          );
          await Scrollable.ensureVisible(
            tester.element(confirm),
            alignment: .5,
          );
          await tester.pump();
          Focus.of(tester.element(find.text('Confirm simulated payment')))
              .requestFocus();
          await tester.pump();
          final style = tester.widget<FilledButton>(confirm).style!;
          final focusedBorder = style.side!.resolve({WidgetState.focused})!;
          expect(
            focusedBorder.color,
            largeText ? CitysideTokens.darkFocusRing : CitysideTokens.focusRing,
          );
          expect(focusedBorder.width, greaterThanOrEqualTo(2));
          await tester.sendKeyEvent(LogicalKeyboardKey.enter);
          for (var i = 0; i < 30 && decisions.isEmpty; i++) {
            await tester.runAsync(
              () => Future<void>.delayed(const Duration(milliseconds: 10)),
            );
            await tester.pump(const Duration(milliseconds: 50));
          }
          expect(decisions, hasLength(1));
          expect(decisions.single['approvalId'], approval);
          expect(decisions.single['decision'], 'approve');
          await tester.pumpWidget(const SizedBox.shrink());
        }, () => client);
      },
    );
  }
}
