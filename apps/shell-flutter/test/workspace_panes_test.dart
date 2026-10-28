import 'package:flutter/material.dart';

import 'dart:ui' show DisplayFeature, DisplayFeatureType, DisplayFeatureState;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:superapp_flutter/workspace_panes.dart';
import 'package:superapp_flutter/theme/tokens.g.dart';

void main() {
  testWidgets('phone swap changes the selected view and can switch back', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: WorkspacePanes(
            conversation: Text('Chat content'),
            details: Text('Details content'),
          ),
        ),
      ),
    );
    expect(find.text('Chat content'), findsOneWidget);
    await tester.tap(find.byTooltip('Swap panes'));
    await tester.pumpAndSettle();
    expect(find.text('Details content'), findsOneWidget);
    expect(
      tester
          .widget<SegmentedButton<bool>>(find.byType(SegmentedButton<bool>))
          .selected,
      {false},
    );
    await tester.tap(find.byTooltip('Swap panes'));
    await tester.pumpAndSettle();
    expect(find.text('Chat content'), findsOneWidget);
    expect(
      tester
          .widget<SegmentedButton<bool>>(find.byType(SegmentedButton<bool>))
          .selected,
      {true},
    );
  });
  testWidgets('divider has a 44px target and a visible keyboard focus ring', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: WorkspacePanes(
            conversation: Text('Chat content'),
            details: Text('Details content'),
          ),
        ),
      ),
    );
    final divider = find.byKey(const ValueKey('pane-divider'));
    expect(tester.getSize(divider).width, greaterThanOrEqualTo(44));
    expect(tester.getSize(divider).height, greaterThanOrEqualTo(44));
    for (final label in [
      'Swap panes',
      'Maximize conversation',
      'Maximize service details',
    ]) {
      final size = tester.getSize(find.byTooltip(label));
      expect(size.width, greaterThanOrEqualTo(44), reason: label);
      expect(size.height, greaterThanOrEqualTo(44), reason: label);
    }
    var reached = false;
    for (var i = 0; i < 10 && !reached; i++) {
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      reached = Focus.of(tester.element(find.byIcon(Icons.drag_indicator)))
          .hasPrimaryFocus;
    }
    expect(
      reached,
      isTrue,
      reason: 'the divider must be reachable by keyboard',
    );
    final decoration =
        tester
                .widget<DecoratedBox>(
                  find.byKey(const ValueKey('pane-divider-focus')),
                )
                .decoration
            as BoxDecoration;
    final border = decoration.border! as Border;
    expect(border.top.color, CitysideTokens.focusRing);
    expect(border.top.width, greaterThanOrEqualTo(2));
    final before = tester
        .getSize(find.byKey(const ValueKey('conversation')))
        .width;
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.pump();
    expect(
      tester.getSize(find.byKey(const ValueKey('conversation'))).width - before,
      closeTo((1200 - tester.getSize(divider).width) * .10, 2),
    );
    await tester.tap(find.byTooltip('Maximize conversation'));
    await tester.pump();
    await tester.tap(find.byTooltip('Restore conversation'));
    await tester.pump();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 3));
  });
  testWidgets('divider focus uses the dark token with reduced motion', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(brightness: Brightness.dark),
        home: const MediaQuery(
          data: MediaQueryData(size: Size(1200, 900), disableAnimations: true),
          child: Scaffold(
            body: WorkspacePanes(
              conversation: Text('Chat'),
              details: Text('Details'),
            ),
          ),
        ),
      ),
    );
    Focus.of(tester.element(find.byIcon(Icons.drag_indicator))).requestFocus();
    await tester.pump();
    final decoration =
        tester
                .widget<DecoratedBox>(
                  find.byKey(const ValueKey('pane-divider-focus')),
                )
                .decoration
            as BoxDecoration;
    expect(
      (decoration.border! as Border).top.color,
      CitysideTokens.darkFocusRing,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 3));
  });
  for (final vertical in [true, false]) {
    testWidgets(
      'keeps both panes clear of a ${vertical ? 'book' : 'clamshell'} hinge',
      (tester) async {
        tester.view.physicalSize = const Size(824, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final hinge = vertical
            ? const Rect.fromLTWH(400, 0, 24, 900)
            : const Rect.fromLTWH(0, 438, 824, 24);
        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(
                size: const Size(824, 900),
                displayFeatures: [
                  DisplayFeature(
                    bounds: hinge,
                    type: DisplayFeatureType.hinge,
                    state: DisplayFeatureState.postureHalfOpened,
                  ),
                ],
              ),
              child: const Scaffold(
                body: WorkspacePanes(
                  conversation: Text('Conversation content'),
                  details: Text('Service content'),
                ),
              ),
            ),
          ),
        );
        final chat = tester.getRect(find.byKey(const ValueKey('conversation')));
        final details = tester.getRect(
          find.byKey(const ValueKey('service details')),
        );
        expect(chat.overlaps(hinge), isFalse);
        expect(details.overlaps(hinge), isFalse);
        expect(
          vertical ? chat.right : chat.bottom,
          vertical ? hinge.left : hinge.top,
        );
        expect(
          vertical ? details.left : details.top,
          vertical ? hinge.right : hinge.bottom,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
  testWidgets('equal panes resize, swap and restore without losing the draft', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: WorkspacePanes(
            conversation: TextField(controller: controller),
            details: const Text('Service result'),
          ),
        ),
      ),
    );
    final chat = find.byKey(const ValueKey('conversation'));
    final details = find.byKey(const ValueKey('service details'));
    expect(
      (tester.getSize(chat).width - tester.getSize(details).width).abs(),
      lessThan(2),
    );
    await tester.enterText(find.byType(TextField), 'Keep this draft');
    final grip = find.byIcon(Icons.drag_indicator);
    await tester.drag(grip, const Offset(100, 0));
    await tester.pump();
    expect(
      tester.getSize(chat).width,
      greaterThan(tester.getSize(details).width),
    );
    await tester.tap(find.byTooltip('Swap panes'));
    await tester.pump();
    expect(
      tester.getTopLeft(chat).dx,
      greaterThan(tester.getTopLeft(details).dx),
    );
    expect(controller.text, 'Keep this draft');
    await tester.tap(find.byTooltip('Maximize conversation'));
    await tester.pump();
    expect(find.text('Service result'), findsNothing);
    await tester.tap(find.byTooltip('Restore conversation'));
    await tester.pump();
    expect(find.text('Service result'), findsOneWidget);
    expect(controller.text, 'Keep this draft');
    Focus.of(tester.element(find.byIcon(Icons.drag_indicator))).requestFocus();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(
      (tester.getSize(chat).width - tester.getSize(details).width).abs(),
      lessThan(2),
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 3));
  });
  testWidgets('phone view switching retains the composer draft', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: WorkspacePanes(
            conversation: TextField(controller: controller),
            details: const Text('Service result'),
          ),
        ),
      ),
    );
    await tester.enterText(find.byType(TextField), 'Phone draft');
    await tester.tap(find.text('Service details').first);
    await tester.pump();
    expect(find.text('Service result'), findsOneWidget);
    await tester.tap(find.text('Chat'));
    await tester.pump();
    expect(find.byType(TextField), findsOneWidget);
    expect(controller.text, 'Phone draft');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 3));
  });
}
