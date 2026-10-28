import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/focused_workspace.dart';
import 'package:superapp_flutter/theme/tokens.g.dart';

void main() {
  for (final largeText in [false, true]) {
    testWidgets(
      'focused conversation controls on a ${largeText ? 'short large-text' : 'standard'} phone',
      (tester) async {
        const id = '00000000-0000-4000-8000-000000000001';
        tester.view.physicalSize = const Size(320, 520);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final requests = <String>[];
        final client = MockClient((request) async {
          requests.add('${request.method} ${request.url.path}');
          final value = request.method == 'POST'
              ? {'threadId': id}
              : {
                  'threadId': id,
                  'uiContract': 'cityside-compat-v1',
                  'status': 'ready',
                  'reply': '',
                  'messages': <Object>[],
                  'next': <String>[],
                  'surface': {'sessionId': id, 'view': <String, dynamic>{}},
                };
          return http.Response(jsonEncode(value), 200);
        });
        await http.runWithClient(() async {
          await tester.pumpWidget(
            MaterialApp(
              home: MediaQuery(
                data: MediaQueryData(
                  size: const Size(320, 520),
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
            i < 20 && find.text('Message about fines').evaluate().isEmpty;
            i++
          ) {
            await tester.runAsync(
              () => Future<void>.delayed(const Duration(milliseconds: 10)),
            );
            await tester.pump(const Duration(milliseconds: 50));
          }
          expect(tester.takeException(), isNull);
          expect(
            find.text('Message about fines'),
            findsOneWidget,
            reason:
                'requests: $requests; error: ${find.textContaining('The result was not confirmed').evaluate().isNotEmpty}',
          );
          for (final label in [
            'Send message',
            'Show outstanding fines',
            'Review payment',
            'Renew vehicle registration',
            'Cancel conversation',
          ]) {
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
            expect(
              tester.getBottomRight(button).dy,
              lessThanOrEqualTo(520),
              reason: '$label: size $size; top ${tester.getTopLeft(button).dy}',
            );
            expect(button.hitTestable(), findsOneWidget, reason: label);
          }
          final field = find.byType(TextField);
          await tester.ensureVisible(field);
          await tester.tap(field);
          await tester.pump();
          final decorator = tester.widget<InputDecorator>(
            find.byType(InputDecorator),
          );
          expect(decorator.isFocused, isTrue);
          final border =
              decorator.decoration.focusedBorder! as OutlineInputBorder;
          expect(border.borderSide.color, CitysideTokens.focusRing);
          expect(border.borderSide.width, greaterThanOrEqualTo(2));
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
        }, () => client);
      },
    );
  }
}
