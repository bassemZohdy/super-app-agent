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
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blueAccent),
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
    {'role': 'assistant', 'text': 'Hello from SuperApp Flutter! Tap below to interact with the Agent.'}
  ];
  Map<String, dynamic>? _currentSurface;
  String? _thinkingDelta;
  final String _sessionId = 'flutter_${DateTime.now().millisecondsSinceEpoch}';
  final String _gatewayUrl = 'http://localhost:4000';

  Future<void> _sendIntent(String text) async {
    setState(() {
      _messages.add({'role': 'user', 'text': text});
      _thinkingDelta = 'Agent evaluating intent via LangGraph...';
    });

    try {
      final res = await http.post(
        Uri.parse('$_gatewayUrl/api/a2ui/intent'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'sessionId': _sessionId,
          'text': text,
          'handshake': {
            'platform': 'flutter',
            'viewport': {'width': 400, 'height': 800, 'category': 'mobile'},
            'supportedComponents': ['SurfaceCard', 'ChoiceGroup', 'Button', 'MetricWidget'],
          }
        }),
      );

      if (res.statusCode == 200) {
        setState(() {
          _thinkingDelta = null;
        });
      }
    } catch (e) {
      setState(() {
        _thinkingDelta = null;
        _messages.add({'role': 'assistant', 'text': 'Could not reach Gateway at $_gatewayUrl'});
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDesktop = MediaQuery.of(context).size.width >= 768;

    return Scaffold(
      appBar: AppBar(
        title: const Text('SuperApp Agent (Flutter)'),
        backgroundColor: Colors.blueAccent,
        foregroundColor: Colors.white,
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 16),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.white24,
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Text('💳 \$142.50', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
      body: isDesktop
          ? Row(
              children: [
                Expanded(flex: 4, child: _buildAgentPane()),
                const VerticalDivider(width: 1),
                Expanded(flex: 6, child: _buildCanvasPane()),
              ],
            )
          : Column(
              children: [
                Expanded(child: _buildCanvasPane()),
                const Divider(height: 1),
                SizedBox(height: 300, child: _buildAgentPane()),
              ],
            ),
    );
  }

  Widget _buildAgentPane() {
    return Container(
      color: Colors.grey.shade50,
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          Expanded(
            child: ListView.builder(
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                final isUser = msg['role'] == 'user';
                return Align(
                  alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: isUser ? Colors.blueAccent : Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: isUser ? null : Border.all(color: Colors.grey.shade300),
                    ),
                    child: Text(
                      msg['text'] ?? '',
                      style: TextStyle(color: isUser ? Colors.white : Colors.black87),
                    ),
                  ),
                );
              },
            ),
          ),
          if (_thinkingDelta != null)
            Padding(
              padding: const EdgeInsets.all(8.0),
              child: Text('⚡ $_thinkingDelta', style: const TextStyle(fontStyle: FontStyle.italic, color: Colors.orange)),
            ),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed: () => _sendIntent('Book a Comfort Ride to Airport'),
                  child: const Text('Book Cab'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ElevatedButton(
                  onPressed: () => _sendIntent('Order Pizza Diavola'),
                  child: const Text('Order Food'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildCanvasPane() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Card(
          elevation: 3,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          child: const Padding(
            padding: EdgeInsets.all(32.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.auto_awesome, size: 48, color: Colors.blueAccent),
                SizedBox(height: 16),
                Text(
                  'AG-UI Flutter Widget Factory',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 8),
                Text(
                  'Dynamically renders native Flutter Widgets from AG-UI JSON schema.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.black54),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
