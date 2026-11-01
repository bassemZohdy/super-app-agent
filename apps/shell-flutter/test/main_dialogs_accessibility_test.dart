import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superapp_flutter/main.dart';

// P2-14: the settings dialog, the services list and the saved conversations list are where people
// change language and privacy and move between services, so every choice in them is a 44px target
// that stays reachable at enlarged text on a small phone.
void main() {
  final cases = <({String name, Size size, double scale})>[
    (name: 'desktop', size: const Size(1200, 900), scale: 1),
    (name: 'phone with large text', size: const Size(360, 700), scale: 2),
  ];
  for (final c in cases) {
    testWidgets('shell dialogs have 44px choices on ${c.name}', (tester) async {
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
          case '/api/services':
            data = {
              'services': [
                {'id': 'fines', 'name': 'Traffic fines'},
                {'id': 'wallet', 'name': 'Wallet'},
              ],
            };
          case '/api/sessions':
            data = {
              'sessions': [
                {
                  'sessionId': 'saved_session',
                  'accountId': 'personal',
                  'title': 'Saved chat',
                },
              ],
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

        Future<void> open(String tooltip) async {
          if (c.size.width < 900) {
            await tester.tap(find.byTooltip('Workspace tools'));
            await tester.pumpAndSettle();
            await tester.tap(find.text(tooltip));
          } else {
            await tester.tap(find.byTooltip(tooltip));
          }
          await tester.pumpAndSettle();
        }

        void expectTarget(Finder finder, String label) {
          expect(finder, findsWidgets, reason: '$label is drawn');
          final size = tester.getSize(finder.first);
          expect(
            size.height,
            greaterThanOrEqualTo(44),
            reason: '$label is shorter than the touch target',
          );
          expect(
            size.width,
            greaterThanOrEqualTo(44),
            reason: '$label is narrower than the touch target',
          );
        }

        await open('Conversation settings');
        expectTarget(find.byType(DropdownButtonFormField<String>), 'Language');
        expectTarget(find.byType(SwitchListTile), 'Share profile switch');
        await tester.tapAt(const Offset(2, 2));
        await tester.pumpAndSettle();

        await open('Explore services');
        expectTarget(find.byType(SimpleDialogOption), 'Service choice');
        await tester.tapAt(const Offset(2, 2));
        await tester.pumpAndSettle();

        await open('Saved conversations');
        expectTarget(find.byType(SimpleDialogOption), 'Saved conversation');
        await tester.tapAt(const Offset(2, 2));
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      }, () => client);
    });
  }
}
