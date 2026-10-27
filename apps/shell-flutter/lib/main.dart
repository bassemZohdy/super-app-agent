import 'shared/contracts.g.dart';
import 'dart:convert';
import 'dart:async';

import 'event_stream.dart';
import 'delegation_panel.dart';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'theme/tokens.g.dart';
import 'workspace_panes.dart';
import 'focused_workspace.dart';
import 'connections_panel.dart';
import 'shared/locale.dart';
import 'shared/surface_payload.dart';
import 'shared/browser_auth.dart';

void main() {
  runApp(const SuperAppFlutter());
}

class SuperAppFlutter extends StatelessWidget {
  const SuperAppFlutter({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Cityside — Your city concierge',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: CitysideTokens.primitiveTeal700,
        ),
        scaffoldBackgroundColor: CitysideTokens.primitiveSlate50,
        fontFamily: 'Roboto',
        fontFamilyFallback: const ['Noto Naskh Arabic'],
        appBarTheme: const AppBarTheme(elevation: 0, centerTitle: false),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: CitysideTokens.primitiveWhite,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        ),
        useMaterial3: true,
      ),
      home: Uri.base.path.replaceFirst(RegExp(r'/$'), '') == '/services/fines'
          ? const FocusedWorkspace()
          : const SuperAppHomeScreen(),
    );
  }
}

class SuperAppHomeScreen extends StatefulWidget {
  const SuperAppHomeScreen({super.key});

  @override
  State<SuperAppHomeScreen> createState() => _SuperAppHomeScreenState();
}

class _SuperAppHomeScreenState extends State<SuperAppHomeScreen>
    with WidgetsBindingObserver {
  final List<Map<String, String>> _messages = [
    {
      'role': 'assistant',
      'text': 'Marhaba. I’m Rashid, your city concierge. Let’s take care of your commute, bills or next move.',
    },
  ];
  Map<String, dynamic>? _currentSurface;
  String? _thinkingDelta;
  final Map<String, String> _choices = {};
  final Map<String, String> _formValues = {};
  bool _requestPending = false;
  Map<String, dynamic>? _model;
  String _locale = 'en';
  bool _shareProfile = true;
  String t(String key) => citysideText(_locale, key);
  String _connectionLabel = 'Connecting…';
  CitizenEventStream? _events;
  bool _streamEnabled = false;
  String _streamStatus = 'Live updates disconnected';
  String _sessionId = 'flutter_${DateTime.now().millisecondsSinceEpoch}';
  final String _gatewayUrl = const String.fromEnvironment(
    'GATEWAY_URL',
    defaultValue: 'http://localhost:4000',
  );
  String _keycloakToken = 'demo-local'; // local demo only
  bool _loginRequired = false;
  bool _authReady = false;
  String _userName = 'Demo citizen';
  String _accountId = '';
  String? _authError;
  List<Map<String, dynamic>> _accounts = [];
  final TextEditingController _promptController = TextEditingController();

  @override
  void initState() {
    super.initState();
    if (browserAuthAvailable) {
      _locale = readBrowserLocale().toLowerCase().startsWith('ar')
          ? 'ar'
          : 'en';
    }
    _messages.first['text'] = t('ng.welcome');
    WidgetsBinding.instance.addObserver(this);
    _checkConnection();
    _initializeAuth();
  }

  Future<void> _initializeAuth() async {
    try {
      final response = await http.get(
        Uri.parse('$_gatewayUrl/api/auth/config'),
      );
      final config = jsonDecode(response.body) as Map<String, dynamic>;
      _streamEnabled = config['enabled'] == true;
      if (config['enabled'] == true) {
        final signedIn =
            browserAuthAvailable && await configureBrowserAuth(config);
        if (signedIn) {
          await _loadAccounts();
          _connectStream();
        }
        if (mounted) {
          setState(() {
            _loginRequired = !signedIn;
            _authReady = true;
            if (!browserAuthAvailable) _authError = 'Use the web build for Keycloak PKCE sign-in. Native sign-in is not configured.';
          });
        }
      } else {
        await _loadAccounts();
        if (mounted) setState(() => _authReady = true);
        _connectStream();
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _authReady = true;
          _loginRequired = true;
          _authError = 'Could not load sign-in settings.';
        });
      }
    }
  }

  Future<void> _signIn() async {
    if (_requestPending) return;
    setState(() {
      _requestPending = true;
      _authError = null;
    });
    try {
      await loginBrowserAuth();
    } catch (_) {
      if (mounted) {
        setState(() => _authError = 'Could not start Keycloak sign-in.');
      }
    } finally {
      if (mounted) setState(() => _requestPending = false);
    }
  }

  void _connectStream() {
    _events?.close();
    if (!_streamEnabled || _loginRequired || _accountId.isEmpty || !mounted) {
      return;
    }
    final sid = _sessionId;
    _events = CitizenEventStream(
      url: Uri.parse(
        '$_gatewayUrl/api/a2ui/stream',
      ).replace(queryParameters: {'sessionId': sid, 'accountId': _accountId}),
      sessionId: sid,
      authorization: _authorization,
      onStatus: (status) {
        if (mounted && _sessionId == sid) {
          setState(() => _streamStatus = status);
        }
      },
      onAuthRequired: () {
        if (mounted && _sessionId == sid) {
          setState(() {
            _loginRequired = true;
            _messages.clear();
            _currentSurface = null;
            _choices.clear();
          });
        }
      },
      onEnvelope: (envelope) {
        if (!mounted || _sessionId != sid) return;
        final data = envelope['data'];
        if (data is! Map<String, dynamic>) return;
        if (envelope['type'] == 'A2UI_RENDER_SURFACE') {
          try {
            setState(() {
              _applySurface(data['surface']);
              _thinkingDelta = null;
            });
          } on FormatException {
            setState(
              () => _streamStatus =
                  'Invalid live update; refresh the conversation.',
            );
          }
        } else if (envelope['type'] == 'A2UI_STREAM_DELTA' &&
            data['text'] is String) {
          setState(() => _thinkingDelta = data['text'] as String);
        }
      },
    );
    unawaited(_events!.run());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _connectStream();
    } else {
      _events?.close();
    }
  }

  void _switchAccount(String value) {
    if (_requestPending) return;
    setState(() {
      _accountId = value;
      _shareProfile = true;
      _sessionId = 'flutter_${DateTime.now().microsecondsSinceEpoch}';
      _messages.clear();
      _currentSurface = null;
      _choices.clear();
      _promptController.clear();
    });
    _connectStream();
  }

  Future<String> _authorization() async {
    if (_streamEnabled) return 'Bearer ${await browserAuthToken()}';
    return 'Bearer $_keycloakToken';
  }

  Future<void> _loadAccounts() async {
    final response = await http.get(
      Uri.parse('$_gatewayUrl/api/accounts'),
      headers: {'Authorization': await _authorization()},
    );
    if (response.statusCode != 200) {
      throw const FormatException('Account discovery failed.');
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    if (mounted) {
      setState(() {
        _accounts = (data['accounts'] as List<dynamic>)
            .cast<Map<String, dynamic>>();
        _accountId = _accounts.first['id'] as String;
        _userName = data['user']?['name'] as String? ?? 'Demo citizen';
      });
    }
    await _restoreConversation();
  }

  Future<void> _restoreConversation() async {
    final saved = readBrowserConversation(_accountId);
    if (saved.isEmpty) return;
    final response = await http.get(
      Uri.parse('$_gatewayUrl/api/sessions/$saved'),
      headers: {'Authorization': await _authorization()},
    );
    if (response.statusCode != 200 || !mounted) return;
    final value = jsonDecode(response.body) as Map<String, dynamic>;
    setState(() {
      _sessionId = saved;
      _shareProfile = value['modelPersonalContext'] != false;
      _messages.clear();
      for (final item in (value['messages'] as List? ?? [])) {
        if (item is Map &&
            ['user', 'assistant'].contains(item['role']) &&
            item['content'] is String) {
          _messages.add({
            'role': item['role'] as String,
            'text': item['content'] as String,
          });
        }
      }
      if (value['surface'] != null) {
        _applySurface(value['surface'], appendMessage: false);
      }
    });
  }

  void _newConversation() {
    if (_requestPending) return;
    setState(() {
      _sessionId = 'flutter_${DateTime.now().microsecondsSinceEpoch}';
      _messages.clear();
      _currentSurface = null;
      _choices.clear();
      _shareProfile = true;
      _promptController.clear();
    });
    writeBrowserConversation(_accountId, '');
    _connectStream();
  }

  Future<void> _showSessions() async {
    final response = await http.get(
      Uri.parse('$_gatewayUrl/api/sessions'),
      headers: {'Authorization': await _authorization()},
    );
    if (!mounted || response.statusCode != 200) return;
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final sessions = (data['sessions'] as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .where((s) => s['accountId'] == _accountId)
        .toList();
    final selected = await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Saved conversations'),
        children: sessions.isEmpty
            ? [
                const Padding(
                  padding: EdgeInsets.all(24),
                  child: Text('No conversations yet.'),
                ),
              ]
            : sessions
                  .map(
                    (session) => SimpleDialogOption(
                      onPressed: () => Navigator.pop(
                        context,
                        session['sessionId'] as String,
                      ),
                      child: Text(
                        session['title'] as String? ?? 'Conversation',
                      ),
                    ),
                  )
                  .toList(),
      ),
    );
    if (selected == null) return;
    final restored = await http.get(
      Uri.parse('$_gatewayUrl/api/sessions/$selected'),
      headers: {'Authorization': await _authorization()},
    );
    if (!mounted || restored.statusCode != 200) return;
    final restoredData = jsonDecode(restored.body) as Map<String, dynamic>;
    setState(() {
      _sessionId = selected;
      writeBrowserConversation(_accountId, selected);
      _shareProfile = restoredData['modelPersonalContext'] != false;
      _currentSurface = null;
      _messages.clear();
      for (final message
          in (restoredData['messages'] as List<dynamic>? ?? [])
              .cast<Map<String, dynamic>>()) {
        if (['user', 'assistant'].contains(message['role'])) {
          _messages.add({
            'role': message['role'] as String,
            'text': message['content'] as String,
          });
        }
      }
      if (restoredData['surface'] != null) {
        _applySurface(restoredData['surface'], appendMessage: false);
      }
    });
    _connectStream();
  }

  Future<void> _signOut() async {
    _events?.close();
    setState(() {
      _keycloakToken = '';
      _loginRequired = true;
      _messages.clear();
      _currentSurface = null;
      _accounts = [];
    });
    if (browserAuthAvailable && _streamEnabled) logoutBrowserAuth();
  }

  Future<void> _showServices() async {
    if (_requestPending) return;
    try {
      final response = await http.get(
        Uri.parse('$_gatewayUrl/api/services'),
        headers: {'Authorization': await _authorization()},
      );
      if (response.statusCode != 200) {
        throw const FormatException('Services unavailable');
      }
      final services =
          (jsonDecode(response.body) as Map<String, dynamic>)['services']
              as List<dynamic>;
      if (!mounted) return;
      final selected = await showDialog<String>(
        context: context,
        builder: (dialog) => SimpleDialog(
          title: Text(t('nav.exploreServices')),
          children: [
            for (final service in services)
              SimpleDialogOption(
                onPressed: () => Navigator.pop(dialog, service['id'] as String),
                child: Text(
                  service['name'] as String? ?? service['id'] as String,
                ),
              ),
          ],
        ),
      );
      if (selected == null || !mounted) return;
      await _prepareService(selected);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Services could not be opened.')),
        );
      }
    }
  }

  Future<void> _prepareService(String serviceId) async {
    if (_requestPending) return;
    if (serviceId == 'fines') {
      Navigator.of(
        context,
      ).push(MaterialPageRoute<void>(builder: (_) => const FocusedWorkspace()));
      return;
    }
    setState(() => _requestPending = true);
    try {
      final response = await http.post(
        Uri.parse('$_gatewayUrl/api/manual/prepare'),
        headers: {
          'Authorization': await _authorization(),
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'sessionId': _sessionId,
          'accountId': _accountId,
          'serviceId': serviceId,
        }),
      );
      if (mounted) _readResponse(response);
    } finally {
      if (mounted) setState(() => _requestPending = false);
    }
  }

  void _openMiniApp(String id) {
    final service = <String, String>{
      'org.superapp.ride': 'parking',
      'org.superapp.food': 'food',
      'org.superapp.wallet': 'wallet',
      'org.superapp.housing': 'housing',
      'gov.smartcity.mobility': 'parking',
      'gov.smartcity.utilities': 'utilities',
      'gov.smartcity.citizenpay': 'wallet',
      'gov.smartcity.housing': 'housing',
    }[id];
    if (service == null) {
      setState(
        () => _messages.add({
          'role': 'assistant',
          'text': 'This service is unavailable.',
        }),
      );
      return;
    }
    unawaited(
      _prepareService(service).catchError((Object _) {
        if (mounted) {
          setState(
            () => _messages.add({
              'role': 'assistant',
              'text': 'The service could not be opened. Inspect the original request.',
            }),
          );
        }
      }),
    );
  }

  void _openTool(String value) {
    if (_requestPending) return;
    switch (value) {
      case 'services':
        _showServices();
      case 'settings':
        _showSettings();
      case 'connections':
        Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => ConnectionsPanel(
              gateway: _gatewayUrl,
              authorization: _authorization,
              locale: _locale,
            ),
          ),
        );
      case 'fines':
        Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => const FocusedWorkspace()),
        );
      case 'delegation':
        Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => DelegationPanel(
              gateway: _gatewayUrl,
              accountId: _accountId,
              authorization: _authorization,
            ),
          ),
        );
      case 'history':
        _showSessions();
      case 'logout':
        _signOut();
    }
  }

  Future<void> _showSettings() async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, update) => AlertDialog(
          title: Text(t('settings.title')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(modelStatusLabel(_model, locale: _locale)),
                DropdownButtonFormField<String>(
                  initialValue: _locale,
                  decoration: InputDecoration(
                    labelText: t('settings.language'),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'en', child: Text('English')),
                    DropdownMenuItem(value: 'ar', child: Text('العربية')),
                  ],
                  onChanged: (value) {
                    if (value == null) return;
                    setState(() {
                      _locale = value;
                      _connectionLabel = modelStatusLabel(
                        _model,
                        locale: _locale,
                      );
                    });
                    writeBrowserLocale(value);
                    update(() {});
                  },
                ),
                SwitchListTile(
                  title: Text(t('settings.shareProfile')),
                  value: _shareProfile,
                  onChanged: _requestPending
                      ? null
                      : (value) async {
                          setState(() => _requestPending = true);
                          update(() {});
                          try {
                            final response = await http.post(
                              Uri.parse('$_gatewayUrl/api/a2ui/model-privacy'),
                              headers: {
                                'Authorization': await _authorization(),
                                'Content-Type': 'application/json',
                              },
                              body: jsonEncode({
                                'sessionId': _sessionId,
                                'accountId': _accountId,
                                'modelPersonalContext': value,
                              }),
                            );
                            if (response.statusCode != 200) {
                              throw const FormatException(
                                'Privacy setting was not saved.',
                              );
                            }
                            writeBrowserConversation(_accountId, _sessionId);
                            if (mounted) {
                              setState(
                                () => _shareProfile =
                                    (jsonDecode(response.body)
                                        as Map<
                                          String,
                                          dynamic
                                        >)['modelPersonalContext'] ==
                                    true,
                              );
                            }
                          } catch (_) {
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Could not save privacy settings. Your previous setting remains active.',
                                  ),
                                ),
                              );
                            }
                          } finally {
                            if (mounted) {
                              setState(() => _requestPending = false);
                            }
                            if (dialogContext.mounted) update(() {});
                          }
                        },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: Text(t('settings.close')),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _checkConnection() async {
    try {
      final response = await http
          .get(Uri.parse('$_gatewayUrl/health'))
          .timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) {
        throw const FormatException('Gateway unavailable');
      }
      final data = jsonDecode(response.body);
      if (mounted) {
        setState(() {
          _model = data['llm'] as Map<String, dynamic>?;
          _connectionLabel = modelStatusLabel(_model, locale: _locale);
        });
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _connectionLabel = modelStatusLabel(
            null,
            locale: _locale,
            connection: 'offline',
          ),
        );
      }
    }
  }

  @override
  void dispose() {
    _events?.close();
    WidgetsBinding.instance.removeObserver(this);
    _promptController.dispose();
    super.dispose();
  }

  void _applySurface(Object? value, {bool appendMessage = true}) {
    if (value is! Map<String, dynamic> ||
        value['version'] != '1.0.0' ||
        value['sessionId'] != _sessionId ||
        value['revision'] is! String ||
        !RegExp(r'^[0-9a-f-]{36}$').hasMatch(value['revision'] as String) ||
        value['view'] is! Map<String, dynamic>) {
      throw const FormatException('Invalid gateway surface');
    }
    final choices = <String, String>{};
    void walk(Object? node, int depth) {
      if (depth > 20 ||
          node is! Map<String, dynamic> ||
          node['type'] is! String ||
          node['id'] is! String) {
        throw const FormatException('Invalid surface node');
      }
      final rawProps = node['properties'];
      if (rawProps != null && rawProps is! Map<String, dynamic>) {
        throw const FormatException('Invalid properties');
      }
      final props = rawProps as Map<String, dynamic>?;
      if (node['type'] == 'ChoiceGroup') {
        final options = props?['options'];
        if (options is! List<dynamic> ||
            options.length > 100 ||
            options.any(
              (o) =>
                  o is! Map<String, dynamic> ||
                  o['id'] is! String ||
                  o['title'] is! String,
            )) {
          throw const FormatException('Invalid options');
        }
        if (options.isNotEmpty) {
          final choicesList = options.cast<Map<String, dynamic>>();
          final selected = choicesList.firstWhere(
            (o) => o['id'] == props?['selectedId'],
            orElse: () => choicesList.first,
          );
          choices[node['id'] as String] = selected['id'] as String;
        }
      }
      final children = node['children'] ?? <Object?>[];
      if (children is! List<dynamic> || children.length > 100) {
        throw const FormatException('Invalid children');
      }
      for (final child in children) {
        walk(child, depth + 1);
      }
    }

    walk(value['view'], 0);
    if (_currentSurface?['revision'] == value['revision']) return;
    _formValues.clear();
    _choices
      ..clear()
      ..addAll(choices);
    _currentSurface = value;
    final message = value['assistantMessage'];
    if (appendMessage &&
        message is Map<String, dynamic> &&
        message['text'] is String) {
      _messages.add({'role': 'assistant', 'text': message['text'] as String});
    }
  }

  void _readResponse(http.Response response) {
    final data = jsonDecode(response.body);
    if (data is! Map<String, dynamic>) {
      throw const FormatException('Invalid response');
    }
    setState(() {
      _connectionLabel = modelStatusLabel(
        _model,
        locale: _locale,
        inference: data['inference']?['status'] as String?,
      );
      if (data['surface'] != null) _applySurface(data['surface']);
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['success'] != true) {
        _messages.add({
          'role': 'assistant',
          'text': data['error'] is String
              ? data['error'] as String
              : 'Request failed (${response.statusCode}).',
        });
      } else if (data['surface'] == null) {
        throw const FormatException('Missing response surface');
      }
    });
    if (response.statusCode == 200) {
      writeBrowserConversation(_accountId, _sessionId);
    }
  }

  Future<void> _sendIntent(String text) async {
    if (text.trim().isEmpty || _requestPending) return;
    _requestPending = true;
    setState(() {
      _messages.add({'role': 'user', 'text': text});
      _thinkingDelta = 'Preparing your request…';
    });
    _promptController.clear();

    try {
      final res = await http.post(
        Uri.parse('$_gatewayUrl/api/a2ui/intent'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': await _authorization(),
        },
        body: jsonEncode({
          'sessionId': _sessionId,
          'accountId': _accountId,
          'text': text,
          'handshake': {
            'platform': 'flutter',
            'viewport': {'width': 400, 'height': 800, 'category': 'mobile'},
            'supportedComponents': supportedComponentTypes,
          },
        }),
      );

      if (!mounted) return;
      _readResponse(res);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _thinkingDelta = null;
        _messages.add({
          'role': 'assistant',
          'text': 'Could not reach Gateway at $_gatewayUrl',
        });
      });
    } finally {
      _requestPending = false;
      if (mounted) setState(() => _thinkingDelta = null);
    }
  }

  Future<void> _dispatchAction(
    String action, [
    Map<String, dynamic>? payload,
  ]) async {
    if (_requestPending) {
      return;
    }
    _requestPending = true;
    setState(() {
      _thinkingDelta = '⚡ Executing action: $action...';
    });

    try {
      final bodyPayload = surfaceActionPayload(
        _currentSurface!['view'] as Map<String, dynamic>,
        {
          'actionType': 'AGENT_ACTION_DISPATCH',
          'payload': payload ?? <String, dynamic>{},
        },
        _choices,
        _formValues,
      );

      final res = await http.post(
        Uri.parse('$_gatewayUrl/api/a2ui/action'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': await _authorization(),
        },
        body: jsonEncode({
          'sessionId': _sessionId,
          'accountId': _accountId,
          'surfaceRevision': _currentSurface?['revision'],
          'action': action,
          'payload': bodyPayload,
        }),
      );

      if (!mounted) return;
      _readResponse(res);
    } catch (e) {
      if (mounted) {
        setState(() {
          _messages.add({
            'role': 'assistant',
            'text': 'Could not confirm the action result. Check status before retrying.',
          });
        });
      }
    } finally {
      _requestPending = false;
      if (mounted) setState(() => _thinkingDelta = null);
    }
  }

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: _locale == 'ar' ? TextDirection.rtl : TextDirection.ltr,
    child: _buildScreen(context),
  );

  Widget _buildScreen(BuildContext context) {
    if (!_authReady) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_loginRequired) {
      return Scaffold(
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.location_city_outlined,
                    size: 48,
                    color: CitysideTokens.primitiveTeal700,
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Your city. Your account.',
                    style: TextStyle(fontSize: 30, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 18),
                  Text(t('ng.signin.hint')),
                  const SizedBox(height: 18),
                  if (_authError != null)
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(_authError!),
                    ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _requestPending ? null : _signIn,
                    child: Text(
                      _requestPending ? 'Signing in…' : t('ng.signin.button'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 76,
        bottom: MediaQuery.sizeOf(context).width < 900
            ? PreferredSize(
                preferredSize: const Size.fromHeight(28),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Text(
                    _connectionLabel,
                    style: const TextStyle(fontSize: 14),
                  ),
                ),
              )
            : null,
        titleSpacing: 22,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'cityside',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 27,
                letterSpacing: -1.2,
              ),
            ),
            Text(
              t('ng.tagline'),
              style: const TextStyle(
                fontSize: 14,
                color: CitysideTokens.primitiveMist62,
              ),
            ),
          ],
        ),
        backgroundColor: CitysideTokens.primitiveWhite,
        foregroundColor: CitysideTokens.primitiveTeal700,
        actions: [
          if (MediaQuery.sizeOf(context).width < 900)
            PopupMenuButton<String>(
              tooltip: 'Workspace tools',
              onSelected: _openTool,
              itemBuilder: (_) => [
                for (final entry in {
                  'services': t('nav.exploreServices'),
                  'settings': t('settings.title'),
                  'connections': t('tools.connections'),
                  'fines': 'Fines & renewal',
                  'delegation': t('tools.delegatedAccess'),
                  'history': 'Saved conversations',
                  'logout': t('nav.signOut'),
                }.entries)
                  PopupMenuItem(
                    value: entry.key,
                    enabled: !_requestPending,
                    child: Text(entry.value),
                  ),
              ],
            )
          else ...[
            IconButton(
              tooltip: t('nav.exploreServices'),
              onPressed: _requestPending ? null : _showServices,
              icon: const Icon(Icons.apps),
            ),
            IconButton(
              tooltip: t('tools.connections'),
              onPressed: _requestPending
                  ? null
                  : () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => ConnectionsPanel(
                          gateway: _gatewayUrl,
                          authorization: _authorization,
                          locale: _locale,
                        ),
                      ),
                    ),
              icon: const Icon(Icons.link),
            ),
            IconButton(
              tooltip: 'Fines & renewal',
              onPressed: _requestPending
                  ? null
                  : () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const FocusedWorkspace(),
                      ),
                    ),
              icon: const Icon(Icons.receipt_long),
            ),
            IconButton(
              tooltip: t('settings.title'),
              onPressed: _requestPending ? null : _showSettings,
              icon: const Icon(Icons.tune),
            ),
            IconButton(
              tooltip: t('tools.delegatedAccess'),
              onPressed: _requestPending
                  ? null
                  : () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => DelegationPanel(
                          gateway: _gatewayUrl,
                          accountId: _accountId,
                          authorization: _authorization,
                        ),
                      ),
                    ),
              icon: const Icon(Icons.verified_user_outlined),
            ),
            IconButton(
              tooltip: 'Saved conversations',
              onPressed: _requestPending ? null : _showSessions,
              icon: const Icon(Icons.history),
            ),
            IconButton(
              tooltip: t('nav.signOut'),
              onPressed: _requestPending ? null : _signOut,
              icon: const Icon(Icons.logout),
            ),
            Center(
              child: Text(
                _connectionLabel,
                style: const TextStyle(
                  fontSize: 14,
                  color: CitysideTokens.successText,
                ),
              ),
            ),
            const SizedBox(width: 18),
          ],
        ],
      ),
      body: Column(
        children: [
          if (_accounts.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _userName,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 14),
                    ),
                  ),
                  DropdownButton<String>(
                    value: _accountId,
                    items: _accounts
                        .map(
                          (account) => DropdownMenuItem<String>(
                            value: account['id'] as String,
                            child: Text(
                              account['label'] as String,
                              style: const TextStyle(fontSize: 14),
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: _requestPending
                        ? null
                        : (value) {
                            if (value != null) _switchAccount(value);
                          },
                  ),
                ],
              ),
            ),
          Expanded(
            child: WorkspacePanes(
              conversation: _buildAgentPane(),
              details: _buildCanvasPane(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAgentPane() {
    return Container(
      color: CitysideTokens.primitiveWhite,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            color: CitysideTokens.primitiveWhite,
            width: double.infinity,
            child: Text(
              t('ng.pane'),
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 14,
                color: CitysideTokens.primitiveSlate900,
              ),
            ),
          ),
          const Divider(height: 1, color: CitysideTokens.primitiveSlate200),
          if (_streamEnabled)
            Text(_streamStatus, style: const TextStyle(fontSize: 14)),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                final isUser = msg['role'] == 'user';
                return Align(
                  alignment: isUser
                      ? Alignment.centerRight
                      : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    constraints: const BoxConstraints(maxWidth: 320),
                    decoration: BoxDecoration(
                      color: isUser
                          ? CitysideTokens.primitiveTeal700
                          : CitysideTokens.primitiveWhite,
                      borderRadius: BorderRadius.circular(12),
                      border: isUser
                          ? null
                          : Border.all(color: CitysideTokens.primitiveSlate200),
                      boxShadow: [
                        BoxShadow(
                          color: CitysideTokens.primitiveSlate900.withValues(
                            alpha: 0.03,
                          ),
                          blurRadius: 4,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: SelectableText(
                      msg['text'] ?? '',
                      style: TextStyle(
                        color: isUser
                            ? CitysideTokens.primitiveWhite
                            : CitysideTokens.primitiveSlate900,
                        fontSize: 14,
                        height: 1.4,
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          if (_thinkingDelta != null)
            Container(
              margin: const EdgeInsets.all(8),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: CitysideTokens.primitiveYellow962,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                '⚡ $_thinkingDelta',
                style: const TextStyle(
                  fontStyle: FontStyle.italic,
                  color: CitysideTokens.primitiveAmber38,
                  fontSize: 14,
                ),
              ),
            ),
          // Suggestion Chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(
              children: [
                ActionChip(
                  label: Text(t('app.newConversation')),
                  onPressed: _requestPending ? null : _newConversation,
                ),
                _buildChip(
                  t('ng.chip.parking'),
                  'Show parking zones in Downtown Dubai',
                ),
                _buildChip(
                  t('ng.chip.bills'),
                  'Check my DEWA electricity and water bill',
                ),
                _buildChip(
                  'Traffic fines',
                  'Show my outstanding traffic fines',
                ),
                _buildChip(
                  'Moving in',
                  'I just signed my Ejari lease, connect my utilities and issue parking for Unit 1402',
                ),
                _buildChip(
                  'Pay together',
                  'Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag',
                ),
                _buildChip(
                  'My profile',
                  'Show my UAE PASS citizen profile and registered vehicles and premises',
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.all(8),
            color: CitysideTokens.primitiveWhite,
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _promptController,
                    decoration: const InputDecoration(
                      hintText: 'Ask Rashid about your city…',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.all(Radius.circular(8)),
                      ),
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      isDense: true,
                    ),
                    onSubmitted: _sendIntent,
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _requestPending
                      ? null
                      : () => _sendIntent(_promptController.text),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: CitysideTokens.primitiveTeal700,
                    foregroundColor: CitysideTokens.primitiveWhite,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: Text(t('ng.send')),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChip(String label, String prompt) {
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: ActionChip(
        label: Text(
          label,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        ),
        onPressed: _requestPending ? null : () => _sendIntent(prompt),
        backgroundColor: CitysideTokens.primitiveSlate50,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    );
  }

  Widget _buildCanvasPane() {
    if (_currentSurface == null) {
      return const SingleChildScrollView(
        child: Center(
          child: Padding(
            padding: EdgeInsets.all(24.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.auto_awesome_outlined,
                  size: 48,
                  color: CitysideTokens.primitiveBlue63,
                ),
                SizedBox(height: 12),
                Text(
                  'A little help. A lot more city.',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 6),
                Text(
                  'From your morning commute to your next move. Ask Rashid and review your options here. City services use simulated data.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: CitysideTokens.primitiveGray49,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final view = _currentSurface!['view'] as Map<String, dynamic>;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 700),
          child: _renderNode(view),
        ),
      ),
    );
  }

  Widget _renderNode(Map<String, dynamic> node) {
    final type = node['type'] as String;
    final props =
        (node['properties'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final children = (node['children'] as List<dynamic>?) ?? [];

    switch (type) {
      case 'SurfaceCard':
        return Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: CitysideTokens.primitiveSlate200),
          ),
          color: CitysideTokens.primitiveWhite,
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: children
                  .map((c) => _renderNode(c as Map<String, dynamic>))
                  .toList(),
            ),
          ),
        );

      case 'Heading':
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            props['text'] as String? ?? '',
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: CitysideTokens.primitiveSlate900,
            ),
          ),
        );

      case 'Text':
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            props['text'] as String? ?? '',
            style: const TextStyle(
              fontSize: 14,
              height: 1.5,
              color: CitysideTokens.primitiveMist27,
            ),
          ),
        );

      case 'Badge':
        return Chip(
          label: Text(
            props['text'] as String? ?? props['label'] as String? ?? '',
          ),
          backgroundColor: CitysideTokens.surface,
        );
      case 'DataTable':
        final columns = (props['columns'] as List? ?? [])
            .cast<Map<String, dynamic>>();
        final rows = (props['rows'] as List? ?? [])
            .cast<Map<String, dynamic>>();
        if (columns.isEmpty) return const Text('No service data columns.');
        return SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            columns: [
              for (final column in columns)
                DataColumn(label: Text(column['title'] as String)),
            ],
            rows: [
              for (final row in rows)
                DataRow(
                  cells: [
                    for (final column in columns)
                      DataCell(
                        Text(
                          row[column['key']] is Map ||
                                  row[column['key']] is List
                              ? jsonEncode(row[column['key']])
                              : row[column['key']]?.toString() ?? '',
                        ),
                      ),
                  ],
                ),
            ],
          ),
        );
      case 'FormInput':
        final name = props['name'] as String? ?? node['id'] as String;
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: TextFormField(
            key: ValueKey('${_currentSurface?['revision']}:$name'),
            initialValue:
                _formValues[name] ?? props['defaultValue'] as String? ?? '',
            enabled: !_requestPending && props['disabled'] != true,
            obscureText: props['inputType'] == 'password',
            decoration: InputDecoration(
              labelText: props['label'] as String? ?? name,
              hintText: props['placeholder'] as String?,
            ),
            onChanged: (value) => _formValues[name] = value,
          ),
        );
      case 'MiniAppEmbed':
        return OutlinedButton(
          onPressed: _requestPending
              ? null
              : () => _openMiniApp(props['miniAppId'] as String? ?? ''),
          child: Text('Open ${props['miniAppId'] ?? 'city services'}'),
        );
      case 'MetricWidget':
        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: CitysideTokens.primitiveWhite,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: CitysideTokens.primitiveSlate200),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                props['label'] as String? ?? '',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: CitysideTokens.primitiveSlate500,
                ),
              ),
              Text(
                '${props['value'] ?? ''}',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: CitysideTokens.primitiveSlate900,
                ),
              ),
            ],
          ),
        );

      case 'ChoiceGroup':
        final options = (props['options'] as List<dynamic>?) ?? [];
        return Column(
          children: options.map((optMap) {
            final opt = optMap as Map<String, dynamic>;
            final id = opt['id'] as String;
            final isSelected = _choices[node['id']] == id;
            return InkWell(
              onTap: () => setState(() => _choices[node['id'] as String] = id),
              child: Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: isSelected
                      ? CitysideTokens.primitiveMist97
                      : CitysideTokens.primitiveWhite,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: isSelected
                        ? CitysideTokens.primitiveTeal700
                        : CitysideTokens.primitiveSlate200,
                    width: isSelected ? 2 : 1,
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          opt['title'] as String? ?? '',
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                          ),
                        ),
                        if (opt['subtitle'] != null)
                          Text(
                            opt['subtitle'] as String,
                            style: const TextStyle(
                              fontSize: 14,
                              color: CitysideTokens.primitiveSlate500,
                            ),
                          ),
                      ],
                    ),
                    if (opt['price'] != null)
                      Text(
                        opt['price'] as String,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                        ),
                      ),
                  ],
                ),
              ),
            );
          }).toList(),
        );

      case 'MapViewer':
        return Container(
          height: 140,
          margin: const EdgeInsets.only(bottom: 16),
          decoration: BoxDecoration(
            color: CitysideTokens.primitiveSlate200,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: CitysideTokens.primitiveMist85),
          ),
          child: const Center(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.directions_car,
                  color: CitysideTokens.primitiveTeal700,
                ),
                SizedBox(width: 8),
                Text(
                  '📍 Live GPS Route View (Simulated)',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                ),
              ],
            ),
          ),
        );

      case 'Button':
        final events = (node['onEvents'] as List<dynamic>?) ?? [];
        final binding = events.isNotEmpty
            ? events.first as Map<String, dynamic>
            : null;
        final payload =
            binding?['payload'] as Map<String, dynamic>? ?? <String, dynamic>{};
        final action = payload['action'] as String? ?? 'submit';
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _requestPending || props['disabled'] == true
                  ? null
                  : () {
                      if (events.isEmpty ||
                          events[0]['actionType'] != 'AGENT_ACTION_DISPATCH') {
                        setState(
                          () => _messages.add({
                            'role': 'assistant',
                            'text': 'This navigation action is not supported in this shell.',
                          }),
                        );
                        return;
                      }
                      _dispatchAction(
                        action,
                        Map<String, dynamic>.from(payload),
                      );
                    },
              style: ElevatedButton.styleFrom(
                backgroundColor: CitysideTokens.primitiveTeal700,
                foregroundColor: CitysideTokens.primitiveWhite,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: Text(
                props['label'] as String? ?? 'Confirm',
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
            ),
          ),
        );

      default:
        return Text('Unsupported component: ${node['type']}');
    }
  }
}
