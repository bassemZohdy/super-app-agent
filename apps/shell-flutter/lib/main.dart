import 'dart:convert';
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
      title: 'SuperApp Flutter Host',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2563EB)),
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

class _SuperAppHomeScreenState extends State<SuperAppHomeScreen> {
  final List<Map<String, String>> _messages = [
    {
      'role': 'assistant',
      'text': 'Welcome to SuperApp Flutter! Tap a suggestion chip or type instructions below to orchestrate mini-apps.'
    }
  ];
  Map<String, dynamic>? _currentSurface;
  String? _thinkingDelta;
  String? _selectedChoice;
  double _walletBalance = 142.50;
  final String _sessionId = 'flutter_${DateTime.now().millisecondsSinceEpoch}';
  final String _gatewayUrl = 'http://localhost:4000';
  final String _keycloakToken = 'demo-local'; // local demo only
  final TextEditingController _promptController = TextEditingController();

  Future<void> _sendIntent(String text) async {
    if (text.trim().isEmpty) return;
    setState(() {
      _messages.add({'role': 'user', 'text': text});
      _thinkingDelta = '🧠 Supervisor evaluating intent via LangGraph...';
    });
    _promptController.clear();

    try {
      final res = await http.post(
        Uri.parse('$_gatewayUrl/api/a2ui/intent'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_keycloakToken',
        },
        body: jsonEncode({
          'sessionId': _sessionId,
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
              'MapViewer'
            ],
          }
        }),
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        setState(() {
          _thinkingDelta = null;
          if (data['surface'] != null) {
            _currentSurface = data['surface'];
            _messages.add({
              'role': 'assistant',
              'text': 'Prepared interactive surface for your request.'
            });
          }
        });
      }
    } catch (e) {
      setState(() {
        _thinkingDelta = null;
        _messages.add({'role': 'assistant', 'text': 'Could not reach Gateway at $_gatewayUrl'});
      });
    }
  }

  Future<void> _dispatchAction(String action, [Map<String, dynamic>? payload]) async {
    setState(() {
      _thinkingDelta = '⚡ Executing action: $action...';
    });

    try {
      final bodyPayload = payload ?? {};
      if (_selectedChoice != null) {
        bodyPayload['selectedChoice'] = _selectedChoice;
      }

      final res = await http.post(
        Uri.parse('$_gatewayUrl/api/a2ui/action'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_keycloakToken',
        },
        body: jsonEncode({
          'sessionId': _sessionId,
          'surfaceRevision': _currentSurface?['revision'],
          'action': action,
          'payload': bodyPayload,
        }),
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        setState(() {
          _thinkingDelta = null;
          if (data['surface'] != null) {
            _currentSurface = data['surface'];
          }
        });
      }
    } catch (e) {
      setState(() {
        _thinkingDelta = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDesktop = MediaQuery.of(context).size.width >= 768;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFF059669),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text('DXB', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 13)),
            ),
            const SizedBox(width: 10),
            const Text('SmartCity Now • Flutter', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ],
        ),
        backgroundColor: const Color(0xFF064E3B),
        foregroundColor: Colors.white,
        actions: [
          Container(
            margin: const EdgeInsets.symmetric(vertical: 10),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFF047857),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFF059669)),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('🛡️ ', style: TextStyle(fontSize: 12)),
                Text('Bassem ', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white)),
                Text('🌟 Golden Visa', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFFF59E0B))),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            margin: const EdgeInsets.only(right: 16),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFF022C22),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              '💳 ${_walletBalance.toStringAsFixed(2)} AED',
              style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF6EE7B7), fontSize: 13),
            ),
          ),
        ],
      ),
      body: isDesktop
          ? Row(
              children: [
                Expanded(flex: 4, child: _buildAgentPane()),
                const VerticalDivider(width: 1, color: Color(0xFFE2E8F0)),
                Expanded(flex: 6, child: _buildCanvasPane()),
              ],
            )
          : Column(
              children: [
                Expanded(child: _buildCanvasPane()),
                const Divider(height: 1, color: Color(0xFFE2E8F0)),
                SizedBox(height: 340, child: _buildAgentPane()),
              ],
            ),
    );
  }

  Widget _buildAgentPane() {
    return Container(
      color: const Color(0xFFF8FAFC),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            color: Colors.white,
            width: double.infinity,
            child: const Text(
              '💬 Autonomous Concierge (LangGraph)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF0F172A)),
            ),
          ),
          const Divider(height: 1, color: Color(0xFFE2E8F0)),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                final isUser = msg['role'] == 'user';
                return Align(
                  alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    constraints: const BoxConstraints(maxWidth: 320),
                    decoration: BoxDecoration(
                      color: isUser ? const Color(0xFF2563EB) : Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: isUser ? null : Border.all(color: const Color(0xFFE2E8F0)),
                      boxShadow: [
                        BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 4, offset: const Offset(0, 2)),
                      ],
                    ),
                    child: Text(
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
                style: const TextStyle(fontStyle: FontStyle.italic, color: Color(0xFF92400E), fontSize: 12),
              ),
            ),
          // Suggestion Chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(
              children: [
                _buildChip('🅿️ Park Zone 302A', 'Park in Zone 302A Downtown Dubai'),
                _buildChip('⚡ DEWA Utilities', 'Check my DEWA electricity and water bill for premise DEWA-201948201'),
                _buildChip('👮 Police Fines', 'Check my Dubai Police traffic radar fines for plate Dubai B-74892'),
                _buildChip('🏠 Ejari Move-In', 'I just signed my Ejari lease, connect my utilities and issue parking for Unit 1402'),
                _buildChip('🏛️ Unified DubaiPay', 'Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag'),
                _buildChip('🛡️ UAE PASS', 'Show my UAE PASS citizen profile and registered vehicles and premises'),
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
                      hintText: 'Ask the concierge...',
                      border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(8))),
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      isDense: true,
                    ),
                    onSubmitted: _sendIntent,
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: () => _sendIntent(_promptController.text),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF2563EB),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
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
        label: Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
        onPressed: () => _sendIntent(prompt),
        backgroundColor: const Color(0xFFF1F5F9),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    );
  }

  Widget _buildCanvasPane() {
    if (_currentSurface == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('🪄', style: TextStyle(fontSize: 40)),
              const SizedBox(height: 12),
              const Text('Ready for Instructions', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              const SizedBox(height: 6),
              Text(
                'Type instructions on the left to compile server-driven AG-UI widgets.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
              ),
            ],
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
    final props = (node['properties'] ?? {}) as Map<String, dynamic>;
    final children = (node['children'] as List<dynamic>?) ?? [];

    switch (type) {
      case 'SurfaceCard':
        return Card(
          elevation: 2,
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
              children: children.map((c) => _renderNode(c as Map<String, dynamic>)).toList(),
            ),
          ),
        );

      case 'Heading':
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            props['text'] ?? '',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
          ),
        );

      case 'Text':
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            props['text'] ?? '',
            style: const TextStyle(fontSize: 13, height: 1.5, color: Color(0xFF334155)),
          ),
        );

      case 'MetricWidget':
        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                props['label'] ?? '',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF64748B)),
              ),
              Text(
                '${props['value'] ?? ''}',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
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
            final isSelected = _selectedChoice == id;
            return InkWell(
              onTap: () => setState(() => _selectedChoice = id),
              child: Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: isSelected ? const Color(0xFFEFF6FF) : Colors.white,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: isSelected ? const Color(0xFF2563EB) : const Color(0xFFE2E8F0),
                    width: isSelected ? 2 : 1,
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(opt['title'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                        if (opt['subtitle'] != null)
                          Text(opt['subtitle'], style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                      ],
                    ),
                    if (opt['price'] != null)
                      Text(opt['price'], style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
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
                Icon(Icons.directions_car, color: Color(0xFF2563EB)),
                SizedBox(width: 8),
                Text('📍 Live GPS Route View (Simulated)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
              ],
            ),
          ),
        );

      case 'Button':
        final events = (node['onEvents'] as List<dynamic>?) ?? [];
        final action = events.isNotEmpty ? (events[0]['payload']?['action'] ?? 'submit') : 'submit';
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => _dispatchAction(action),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF2563EB),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              child: Text(props['label'] ?? 'Confirm', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            ),
          ),
        );

      default:
        return const SizedBox.shrink();
    }
  }
}

