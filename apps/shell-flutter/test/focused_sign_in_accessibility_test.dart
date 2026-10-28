import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:superapp_flutter/focused_workspace.dart';
import 'package:superapp_flutter/theme/tokens.g.dart';

void main() {
  for (final size in [const Size(320, 640), const Size(1200, 900)]) {
    testWidgets(
      'fines sign-in controls meet touch and keyboard requirements at $size',
      (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(const MaterialApp(home: FocusedWorkspace()));
        for (final finder in [
          find.byType(TextField),
          find.widgetWithText(FilledButton, 'Open my fines'),
          find.widgetWithText(
            TextButton,
            'Forget saved conversation reference',
          ),
        ]) {
          final bounds = tester.getSize(finder);
          expect(bounds.width, greaterThanOrEqualTo(44));
          expect(bounds.height, greaterThanOrEqualTo(44));
        }
        final semantics = tester.ensureSemantics();
        expect(find.bySemanticsLabel('Access token'), findsOneWidget);
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pump();
        expect(
          tester
              .widget<EditableText>(find.byType(EditableText))
              .focusNode
              .hasFocus,
          isTrue,
        );
        final decorator = tester.widget<InputDecorator>(
          find.byType(InputDecorator),
        );
        expect(decorator.isFocused, isTrue);
        final border =
            decorator.decoration.focusedBorder! as OutlineInputBorder;
        expect(border.borderSide.color, CitysideTokens.focusRing);
        expect(border.borderSide.width, greaterThanOrEqualTo(2));
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pump();
        expect(
          Focus.of(tester.element(find.text('Open my fines'))).hasFocus,
          isTrue,
        );
        semantics.dispose();
      },
    );
  }
  testWidgets(
    'large text on a short phone remains scrollable without overflow',
    (tester) async {
      tester.view.physicalSize = const Size(320, 520);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        const MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(
              size: Size(320, 520),
              textScaler: TextScaler.linear(2),
              disableAnimations: true,
            ),
            child: FocusedWorkspace(),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(
        find.text('Forget saved conversation reference'),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Forget saved conversation reference'), findsOneWidget);
      expect(
        tester
            .getBottomRight(find.text('Forget saved conversation reference'))
            .dy,
        lessThanOrEqualTo(520),
      );
    },
  );
  testWidgets('dark theme uses the accessible focus token', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(brightness: Brightness.dark),
        home: const FocusedWorkspace(),
      ),
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    final border =
        tester
                .widget<InputDecorator>(find.byType(InputDecorator))
                .decoration
                .focusedBorder!
            as OutlineInputBorder;
    expect(border.borderSide.color, CitysideTokens.darkFocusRing);
  });
}
