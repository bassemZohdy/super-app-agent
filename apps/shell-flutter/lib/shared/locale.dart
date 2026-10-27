import 'catalogs.g.dart';

String citysideText(
  String locale,
  String key, [
  Map<String, Object> values = const {},
]) {
  final text =
      citysideCatalogs[locale]?[key] ?? citysideCatalogs['en']?[key] ?? key;
  return text.replaceAllMapped(
    RegExp(r'\{(\w+)\}'),
    (match) => values[match[1]]?.toString() ?? match[0]!,
  );
}

String modelStatusLabel(
  Map<String, dynamic>? model, {
  String locale = 'en',
  String connection = 'online',
  String? inference,
}) {
  final local =
      ['local', 'llama.cpp'].contains(model?['provider']) ||
      model?['mode'] == 'local';
  final provider = model?['provider'] == 'litellm'
      ? 'LiteLLM'
      : model?['provider'] == 'openrouter'
      ? 'OpenRouter'
      : citysideText(locale, local ? 'model.local' : 'model.unknown');
  final key = connection == 'offline'
      ? 'model.offline'
      : connection == 'checking'
      ? 'model.checking'
      : inference == 'error'
      ? 'model.error'
      : model?['enabled'] != true
      ? 'status.demoMode'
      : model?['configured'] == false
      ? 'model.unconfigured'
      : inference == 'connected'
      ? 'model.connected'
      : model?['ready'] == true
      ? 'model.ready'
      : local
      ? 'model.warming'
      : 'model.configured';
  return citysideText(locale, key, {'provider': provider});
}
