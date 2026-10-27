import 'package:flutter_test/flutter_test.dart';
import 'package:superapp_flutter/shared/surface_payload.dart';

void main() {
  test('Flutter choices and form values follow the same authority rules as the TypeScript shells', () {
    final view = <String, dynamic>{
      'type': 'SurfaceCard',
      'children': [
        for (final id in ['one', 'two'])
          {
            'id': id,
            'type': 'ChoiceGroup',
            'properties': {
              'options': [
                {'id': 'owned'},
              ],
            },
          },
      ],
    };
    final binding = <String, dynamic>{
      'actionType': 'AGENT_ACTION_DISPATCH',
      'payload': {'approvalId': 'server-review'},
    };
    final value = surfaceActionPayload(
      view,
      binding,
      {'one': 'owned', 'two': 'owned'},
      {'approvalId': 'forged-review', 'nickname': 'My demo card'},
    );
    expect(value['approvalId'], 'server-review');
    expect(value['nickname'], 'My demo card');
    expect(value['selectedChoices'], {'one': 'owned', 'two': 'owned'});
    expect(
      () => surfaceActionPayload(view, binding, {
        'one': 'unavailable',
        'two': 'owned',
      }, {}),
      throwsFormatException,
    );
    expect(
      () => surfaceActionPayload(view, {'actionType': 'UNKNOWN'}, {}, {}),
      throwsFormatException,
    );
  });
}
