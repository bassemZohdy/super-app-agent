import 'dart:convert';
import 'dart:js_interop';

const browserAuthAvailable = true;
@JS('citysideAuthConfigure')
external JSPromise<JSBoolean> _configure(JSAny config);
@JS('citysideAuthLogin')
external JSPromise<JSAny?> _login();
@JS('citysideAuthToken')
external JSPromise<JSString> _token();
@JS('citysideAuthLogout')
external void _logout();
@JS('citysideLocaleRead')
external JSString _localeRead();
@JS('citysideLocaleWrite')
external void _localeWrite(JSString locale);
Future<bool> configureBrowserAuth(Map<String, dynamic> config) async =>
    (await _configure(config.jsify()!).toDart).toDart;
Future<void> loginBrowserAuth() async {
  await _login().toDart;
}

Future<String> browserAuthToken() async => (await _token().toDart).toDart;
void logoutBrowserAuth() => _logout();
String readBrowserLocale() => _localeRead().toDart;
void writeBrowserLocale(String locale) => _localeWrite(locale.toJS);

@JS('citysideConversationRead')
external JSString _conversationRead(JSString account);
@JS('citysideConversationWrite')
external void _conversationWrite(JSString account, JSString id);
String readBrowserConversation(String account) =>
    _conversationRead(account.toJS).toDart;
void writeBrowserConversation(String account, String id) =>
    _conversationWrite(account.toJS, id.toJS);

@JS('citysideHingeRead')
external JSString _hingeRead();
Map<String, dynamic>? readBrowserHinge() {
  final value = _hingeRead().toDart;
  return value.isEmpty ? null : jsonDecode(value) as Map<String, dynamic>;
}
