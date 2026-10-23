import 'dart:convert';
import 'dart:async';

import 'event_stream.dart';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

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
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF285C76)),
        scaffoldBackgroundColor: const Color(0xFFF7FAFC),
        fontFamily: 'Avenir Next',
        appBarTheme: const AppBarTheme(elevation: 0, centerTitle: false),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        ),
        useMaterial3: true,
      ),
      home: const SuperAppHomeScreen(),
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
  bool _requestPending = false;
  bool _showDetails = false;
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
  String? _refreshToken;
  DateTime? _tokenExpiry;
  bool _loginRequired = false;
  bool _authReady = false;
  String _userName = 'Demo citizen';
  String _accountId = '';
  String _demoUsername = 'bassem';
  String? _authError;
  String _issuer = 'http://localhost:8085/realms/superapp';
  List<Map<String, dynamic>> _accounts = [];
  final TextEditingController _promptController = TextEditingController();

  @override
  void initState() {
    super.initState();
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
      _issuer = config['issuer'] as String? ?? _issuer;
      _streamEnabled = config['enabled'] == true;
      if (config['enabled'] == true) {
        if (mounted) {
          setState(() {
            _loginRequired = true;
            _authReady = true;
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

  // Local demo grant only. Browser shells use authorization code + PKCE.
  Future<void> _signIn() async {
    if (_requestPending) return;
    setState(() {
      _requestPending = true;
      _authError = null;
    });
    try {
      final response = await http.post(
        Uri.parse('$_issuer/protocol/openid-connect/token'),
        body: {
          'grant_type': 'password',
          'client_id': 'superapp-shell',
          'username': _demoUsername,
          'password': 'demo123',
          'scope': 'openid profile',
        },
      );
      if (response.statusCode != 200) {
        throw const FormatException('Demo sign-in failed.');
      }
      _acceptTokens(jsonDecode(response.body) as Map<String, dynamic>);
      await _loadAccounts();
      if (mounted) {
        setState(() {
          _loginRequired = false;
          _messages.clear();
          _currentSurface = null;
          _sessionId = 'flutter_${DateTime.now().microsecondsSinceEpoch}';
        });
      }
      _connectStream();
    } catch (_) {
      if (mounted) {
        setState(
          () =>
              _authError = 'Demo sign-in failed. Check that Keycloak is ready.',
        );
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
      _sessionId = 'flutter_${DateTime.now().microsecondsSinceEpoch}';
      _messages.clear();
      _currentSurface = null;
      _choices.clear();
      _promptController.clear();
    });
    _connectStream();
  }

  void _acceptTokens(Map<String, dynamic> tokens) {
    _keycloakToken = tokens['access_token'] as String;
    _refreshToken = tokens['refresh_token'] as String?;
    _tokenExpiry = DateTime.now().add(
      Duration(seconds: tokens['expires_in'] as int),
    );
  }

  Future<String> _authorization() async {
    if (_tokenExpiry != null &&
        DateTime.now()
            .add(const Duration(seconds: 30))
            .isAfter(_tokenExpiry!)) {
      final response = await http.post(
        Uri.parse('$_issuer/protocol/openid-connect/token'),
        body: {
          'grant_type': 'refresh_token',
          'client_id': 'superapp-shell',
          'refresh_token': _refreshToken ?? '',
        },
      );
      if (response.statusCode != 200) {
        if (mounted) setState(() => _loginRequired = true);
        throw const FormatException('Sign in again.');
      }
      _acceptTokens(jsonDecode(response.body) as Map<String, dynamic>);
    }
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
        _userName = data['user']?['name'] as String? ?? _demoUsername;
      });
    }
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
    final refresh = _refreshToken;
    setState(() {
      _keycloakToken = '';
      _refreshToken = null;
      _tokenExpiry = null;
      _loginRequired = true;
      _messages.clear();
      _currentSurface = null;
      _accounts = [];
    });
    if (refresh != null) {
      await http.post(
        Uri.parse('$_issuer/protocol/openid-connect/logout'),
        body: {'client_id': 'superapp-shell', 'refresh_token': refresh},
      );
    }
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
        setState(
          () => _connectionLabel = data['llm']?['enabled'] == true
              ? 'OpenRouter ready'
              : 'Demo mode',
        );
      }
    } catch (_) {
      if (mounted) setState(() => _connectionLabel = 'Gateway offline');
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
            'supportedComponents': [
              'SurfaceCard',
              'Heading',
              'Text',
              'ChoiceGroup',
              'Button',
              'MetricWidget',
              'MapViewer',
            ],
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
      if (_choices.length > 1) {
        throw const FormatException('Ambiguous action choices');
      }
      final bodyPayload = Map<String, dynamic>.from(payload ?? {});
      bodyPayload.remove('selectedChoice');
      if (_choices.length == 1) {
        bodyPayload['selectedChoice'] = _choices.values.first;
      }

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
  Widget build(BuildContext context) {
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
                    color: Color(0xFF285C76),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Your city. Your account.',
                    style: TextStyle(fontSize: 30, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 18),
                  const Text('Local demo sign-in through Keycloak'),
                  const SizedBox(height: 18),
                  DropdownButtonFormField<String>(
                    initialValue: _demoUsername,
                    items: const [
                      DropdownMenuItem(
                        value: 'bassem',
                        child: Text('Bassem Zohdy'),
                      ),
                      DropdownMenuItem(
                        value: 'demo-commuter',
                        child: Text('Alex Commuter'),
                      ),
                    ],
                    onChanged: (value) =>
                        setState(() => _demoUsername = value!),
                  ),
                  if (_authError != null)
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(_authError!),
                    ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _requestPending ? null : _signIn,
                    child: Text(
                      _requestPending ? 'Signing in…' : 'Sign in to demo',
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
        titleSpacing: 22,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'cityside',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 27,
                letterSpacing: -1.2,
              ),
            ),
            Text(
              'Your everyday, connected.',
              style: TextStyle(fontSize: 10, color: Color(0xFF8297A5)),
            ),
          ],
        ),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF285C76),
        actions: [
          IconButton(
            tooltip: 'Saved conversations',
            onPressed: _requestPending ? null : _showSessions,
            icon: const Icon(Icons.history),
          ),
          IconButton(
            tooltip: 'Sign out',
            onPressed: _requestPending ? null : _signOut,
            icon: const Icon(Icons.logout),
          ),
          Center(
            child: Text(
              _connectionLabel,
              style: const TextStyle(fontSize: 10, color: Color(0xFF618C7A)),
            ),
          ),
          const SizedBox(width: 18),
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
                      style: const TextStyle(fontSize: 12),
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
                              style: const TextStyle(fontSize: 12),
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
            child: LayoutBuilder(
              builder: (context, constraints) {
                if (constraints.maxWidth >= 850) {
                  return Row(
                    children: [
                      Expanded(flex: 5, child: _buildAgentPane()),
                      const VerticalDivider(width: 1, color: Color(0xFFE2E8F0)),
                      Expanded(flex: 5, child: _buildCanvasPane()),
                    ],
                  );
                }
                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: SegmentedButton<bool>(
                        segments: const [
                          ButtonSegment(
                            value: false,
                            icon: Icon(Icons.chat_bubble_outline),
                            label: Text('Concierge'),
                          ),
                          ButtonSegment(
                            value: true,
                            icon: Icon(Icons.explore_outlined),
                            label: Text('Service details'),
                          ),
                        ],
                        selected: {_showDetails},
                        onSelectionChanged: (value) =>
                            setState(() => _showDetails = value.first),
                      ),
                    ),
                    Expanded(
                      child: _showDetails
                          ? _buildCanvasPane()
                          : _buildAgentPane(),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAgentPane() {
    return Container(
      color: Colors.white,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            color: Colors.white,
            width: double.infinity,
            child: const Text(
              'Rashid, your city concierge',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 13,
                color: Color(0xFF0F172A),
              ),
            ),
          ),
          const Divider(height: 1, color: Color(0xFFE2E8F0)),
          if (_streamEnabled)
            Text(_streamStatus, style: const TextStyle(fontSize: 10)),
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
                      color: isUser ? const Color(0xFF285C76) : Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: isUser
                          ? null
                          : Border.all(color: const Color(0xFFE2E8F0)),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.03),
                          blurRadius: 4,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: SelectableText(
                      msg['text'] ?? '',
                      style: TextStyle(
                        color: isUser ? Colors.white : const Color(0xFF0F172A),
                        fontSize: 13,
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
                color: const Color(0xFFFEF3C7),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                '⚡ $_thinkingDelta',
                style: const TextStyle(
                  fontStyle: FontStyle.italic,
                  color: Color(0xFF92400E),
                  fontSize: 12,
                ),
              ),
            ),
          // Suggestion Chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(
              children: [
                _buildChip('Find parking', 'Park in Zone 302A Downtown Dubai'),
                _buildChip(
                  'Check my bills',
                  'Check my DEWA electricity and water bill for premise DEWA-201948201',
                ),
                _buildChip(
                  'Traffic fines',
                  'Check my Dubai Police traffic radar fines for plate Dubai B-74892',
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
            color: Colors.white,
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
                    backgroundColor: const Color(0xFF285C76),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: const Text('Send'),
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
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
        ),
        onPressed: _requestPending ? null : () => _sendIntent(prompt),
        backgroundColor: const Color(0xFFF1F5F9),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    );
  }

  Widget _buildCanvasPane() {
    if (_currentSurface == null) {
      return SingleChildScrollView(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.auto_awesome_outlined,
                  size: 48,
                  color: Color(0xFF7297AD),
                ),
                const SizedBox(height: 12),
                const Text(
                  'A little help. A lot more city.',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 6),
                Text(
                  'From your morning commute to your next move. Ask Rashid and review your options here. City services use simulated data.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
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
            side: const BorderSide(color: Color(0xFFE2E8F0)),
          ),
          color: Colors.white,
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
              color: Color(0xFF0F172A),
            ),
          ),
        );

      case 'Text':
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            props['text'] as String? ?? '',
            style: const TextStyle(
              fontSize: 13,
              height: 1.5,
              color: Color(0xFF334155),
            ),
          ),
        );

      case 'MetricWidget':
        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                props['label'] as String? ?? '',
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF64748B),
                ),
              ),
              Text(
                '${props['value'] ?? ''}',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF0F172A),
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
                  color: isSelected ? const Color(0xFFEFF6FF) : Colors.white,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: isSelected
                        ? const Color(0xFF285C76)
                        : const Color(0xFFE2E8F0),
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
                              fontSize: 12,
                              color: Color(0xFF64748B),
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
            color: const Color(0xFFE2E8F0),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFCBD5E1)),
          ),
          child: const Center(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.directions_car, color: Color(0xFF285C76)),
                SizedBox(width: 8),
                Text(
                  '📍 Live GPS Route View (Simulated)',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
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
                backgroundColor: const Color(0xFF285C76),
                foregroundColor: Colors.white,
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
