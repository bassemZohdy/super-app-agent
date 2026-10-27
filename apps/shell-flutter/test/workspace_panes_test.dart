import 'package:flutter/material.dart';

import 'dart:ui' show DisplayFeature, DisplayFeatureType, DisplayFeatureState;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:superapp_flutter/workspace_panes.dart';

void main() {
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
