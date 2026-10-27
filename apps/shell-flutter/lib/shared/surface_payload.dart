/// Keep the same binding precedence and choice scope as protocol-core/surface-client.ts.
Map<String, dynamic> surfaceActionPayload(
  Map<String, dynamic> view,
  Map<String, dynamic> binding,
  Map<String, String> choices,
  Map<String, String> formValues,
) {
  if (binding['actionType'] != 'AGENT_ACTION_DISPATCH') {
    throw const FormatException('Unsupported action binding.');
  }
  final payload = <String, dynamic>{
    ...formValues,
    ...?binding['payload'] as Map<String, dynamic>?,
  };
  payload.remove('selectedChoice');
  payload.remove('selectedChoices');
  final selected = <String, String>{};
  void walk(Map<String, dynamic> node) {
    if (node['type'] == 'ChoiceGroup') {
      final options = node['properties']?['options'] as List? ?? [];
      if (options.isNotEmpty) {
        final choice = choices[node['id']];
        if (!options.any((option) => option['id'] == choice)) {
          throw const FormatException(
            'Choose an available option before continuing.',
          );
        }
        selected[node['id'] as String] = choice!;
      }
    }
    for (final child in (node['children'] as List? ?? [])) {
      walk(child as Map<String, dynamic>);
    }
  }

  walk(view);
  if (selected.length == 1) {
    payload['selectedChoice'] = selected.values.first;
  } else if (selected.length > 1) {
    payload['selectedChoices'] = selected;
  }
  return payload;
}
