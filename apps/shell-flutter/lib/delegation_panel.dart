import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class DelegationPanel extends StatefulWidget {
  const DelegationPanel({
    super.key,
    required this.gateway,
    required this.accountId,
    required this.authorization,
  });
  final String gateway;
  final String accountId;
  final Future<String> Function() authorization;
  @override
  State<DelegationPanel> createState() => _DelegationPanelState();
}

class _DelegationPanelState extends State<DelegationPanel> {
  List<Map<String, dynamic>> _grants = [];
  String _notice = '';
  bool _busy = false;
  @override
  void initState() {
    super.initState();
    _work(_load);
  }

  Future<Map<String, dynamic>> _api([
    String path = '',
    String method = 'GET',
    Object? body,
  ]) async {
    final request = http.Request(
      method,
      Uri.parse('${widget.gateway}/api/delegation/grants$path'),
    );
    request.headers.addAll({
      'Authorization': await widget.authorization(),
      'Content-Type': 'application/json',
    });
    if (body != null) request.body = jsonEncode(body);
    final response = await http.Response.fromStream(await request.send())
        .timeout(const Duration(seconds: 20));
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode >= 400) {
      throw FormatException((data['error'] ?? data['code']).toString());
    }
    return data;
  }

  Future<void> _load() async {
    final data = await _api();
    _grants = (data['grants'] as List)
        .cast<Map<String, dynamic>>()
        .where((g) => g['accountId'] == widget.accountId)
        .toList();
  }

  Future<void> _work(Future<void> Function() action) async {
    if (mounted) setState(() => _busy = true);
    try {
      await action();
      await _load();
    } catch (error) {
      _notice = error.toString();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _create(bool write) async {
    await _api('', 'POST', {
      'accountId': widget.accountId,
      'provider': 'payments',
      'method': write ? 'POST' : 'GET',
      'path': write ? '/topups' : '/wallet',
      'body': write
          ? {'amountMinor': 100, 'source': 'demo_approved'}
          : <String, dynamic>{},
      'purpose': write
          ? 'Approve one synthetic AED 1 wallet credit'
          : 'Check my synthetic wallet balance',
      'expiresInSeconds': 300,
      'maxOperations': write ? 1 : 3,
    });
    _notice = 'Consent saved. Review the grant before running it.';
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Delegated access')),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text(
          'Cityside demo broker · current account only · five-minute consent. Review the exact operation before allowing it.',
        ),
        FilledButton(
          onPressed: _busy ? null : () => _work(() => _create(false)),
          child: const Text('Allow up to 3 wallet balance checks'),
        ),
        OutlinedButton(
          onPressed: _busy ? null : () => _work(() => _create(true)),
          child: const Text('Approve one AED 1 demo wallet credit'),
        ),
        Text(_notice, semanticsLabel: 'Delegation status: $_notice'),
        for (final grant in _grants)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(grant['purpose'].toString()),
                  Text(
                    '${grant['used']}/${grant['maxOperations']} executions · ${grant['revokedAt'] != null
                        ? 'Revoked'
                        : (grant['expiresAt'] as int) <= DateTime.now().millisecondsSinceEpoch
                        ? 'Expired'
                        : 'Active'}',
                  ),
                  TextButton(
                    onPressed:
                        _busy ||
                            grant['revokedAt'] != null ||
                            (grant['expiresAt'] as int) <=
                                DateTime.now().millisecondsSinceEpoch ||
                            (grant['used'] as int) >=
                                (grant['maxOperations'] as int)
                        ? null
                        : () => _work(() async {
                            final data = await _api(
                              '/${grant['id']}/execute',
                              'POST',
                              {
                                'requestKey':
                                    'flutter-${DateTime.now().microsecondsSinceEpoch}',
                              },
                            );
                            final result =
                                data['result'] as Map<String, dynamic>;
                            final balance =
                                result['balance'] ?? result['remainingBalance'];
                            _notice = balance is num
                                ? 'Approved operation completed. Wallet balance: AED ${balance.toStringAsFixed(2)}.'
                                : 'Approved operation completed.';
                          }),
                    child: const Text('Run approved operation'),
                  ),
                  TextButton(
                    onPressed: _busy || grant['revokedAt'] != null
                        ? null
                        : () => _work(() async {
                            await _api('/${grant['id']}', 'DELETE');
                            _notice = 'Consent revoked. Further delegated operations will be denied.';
                          }),
                    child: const Text('Revoke consent'),
                  ),
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => _work(() async {
                            final data = await _api('/${grant['id']}/history');
                            _notice = (data['history'] as List)
                                .map((e) => e['event'])
                                .join('\n');
                          }),
                    child: const Text('View audit history'),
                  ),
                ],
              ),
            ),
          ),
      ],
    ),
  );
}
