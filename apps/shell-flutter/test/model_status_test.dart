import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:superapp_flutter/shared/locale.dart';

void main() {
  test('Flutter provider status matches the shared TypeScript contract in both languages', () {
    final cases = jsonDecode(
      File('test/fixtures/model-status.json').readAsStringSync(),
    ) as List<dynamic>;
    for (final entry in cases) {
      final item = entry as Map<String, dynamic>;
      expect(
        modelStatusLabel(
          item['model'] as Map<String, dynamic>,
          locale: item['locale'] as String,
        ),
        item['expected'],
      );
    }
  });
}
