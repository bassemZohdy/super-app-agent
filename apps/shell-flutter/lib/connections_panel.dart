import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'shared/locale.dart';

class ConnectionsPanel extends StatefulWidget {
  const ConnectionsPanel({
    super.key,
    required this.gateway,
    required this.authorization,
    this.locale = 'en',
  });
  final String gateway;
  final Future<String> Function() authorization;
  final String locale;
  @override
  State<ConnectionsPanel> createState() => _ConnectionsPanelState();
}

class _ConnectionsPanelState extends State<ConnectionsPanel> {
  bool busy = false;
  String error = '';
  List<dynamic> providers = [], calls = [];
  String t(String key, [Map<String, Object> values = const {}]) =>
      citysideText(widget.locale, key, values);
  @override
  void initState() {
    super.initState();
    load(false);
  }

  Future<void> load(bool refresh) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = '';
    });
    try {
      final response = await http
          .get(
            Uri.parse(
              '${widget.gateway}/api/connections${refresh ? '?refresh=1' : ''}',
            ),
            headers: {'Authorization': await widget.authorization()},
          )
          .timeout(const Duration(seconds: 15));
      if (response.statusCode != 200) {
        throw const FormatException('Connections unavailable');
      }
      final value = jsonDecode(response.body) as Map<String, dynamic>;
      if (mounted) {
        setState(() {
          providers = value['providers'] as List<dynamic>;
          calls = value['calls'] as List<dynamic>;
        });
      }
    } catch (_) {
      if (mounted) setState(() => error = t('connections.unavailable'));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: widget.locale == 'ar'
        ? TextDirection.rtl
        : TextDirection.ltr,
    child: Scaffold(
      appBar: AppBar(title: Text(t('connections.title'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(t('connections.intro')),
          FilledButton(
            onPressed: busy ? null : () => load(true),
            child: Text(t('connections.check')),
          ),
          if (busy) const LinearProgressIndicator(),
          if (error.isNotEmpty) Text(error),
          for (final item in providers)
            ExpansionTile(
              title: Text(item['provider'] as String),
              subtitle: Text(
                item['ok'] == true
                    ? t('connections.reachableMany', {
                        'count': (item['operations'] as List).length,
                      })
                    : t('connections.refused', {
                        'reason':
                            item['problem'] as String? ??
                            t('connections.unknownProblem'),
                      }),
              ),
              children: [
                for (final op in (item['operations'] as List? ?? []))
                  ListTile(
                    title: Text(op['operationId'] as String),
                    subtitle: SelectableText('${op['method']} ${op['path']}'),
                  ),
              ],
            ),
          Text(
            t('connections.recent'),
            style: Theme.of(context).textTheme.titleLarge,
          ),
          if (calls.isEmpty) Text(t('connections.noCalls')),
          for (final call in calls)
            ListTile(
              title: Text(
                '${call['provider']} · ${call['method']} ${call['path']}',
              ),
              subtitle: Text('${call['status']} · ${call['ms']} ms'),
            ),
        ],
      ),
    ),
  );
}
