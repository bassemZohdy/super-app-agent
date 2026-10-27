const browserAuthAvailable = false;
Future<bool> configureBrowserAuth(Map<String, dynamic> config) async => false;
Future<void> loginBrowserAuth() async =>
    throw UnsupportedError('Browser PKCE requires the web build.');
Future<String> browserAuthToken() async =>
    throw UnsupportedError('Browser PKCE requires the web build.');
void logoutBrowserAuth() {}
String readBrowserLocale() => 'en';
void writeBrowserLocale(String locale) {}

String readBrowserConversation(String account) => '';
void writeBrowserConversation(String account, String id) {}

Map<String, dynamic>? readBrowserHinge() => null;
