import 'dart:convert';

import 'shared/contracts.g.dart';

import 'dart:math';

import 'package:http/http.dart' as http;

class FocusedClient {
  FocusedClient(this._token, {http.Client? client, Uri? base})
    : _client = client ?? http.Client(),
      _base =
          base ??
          Uri.parse(
            const String.fromEnvironment(
              'AGENT_API_URL',
              defaultValue: 'http://127.0.0.1:4300/api/agent/',
            ),
          );
  final String _token;
  final http.Client _client;
  final Uri _base;
  static final _id = RegExp(r'^[a-f0-9-]{36}$');
  Future<Map<String, dynamic>> _request(
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    final request = http.Request(
      body == null ? 'GET' : 'POST',
      _base.resolve(path),
    )..followRedirects = false;
    request.headers.addAll({
      'Authorization': 'Bearer $_token',
      'Accept': 'application/json',
    });
    if (body != null) {
      request.headers.addAll({
        'Content-Type': 'application/json',
        'Idempotency-Key': base64UrlEncode(
          List<int>.generate(24, (_) => Random.secure().nextInt(256)),
        ),
      });
      request.body = jsonEncode(body);
    }
    final response = await _client
        .send(request)
        .timeout(const Duration(milliseconds: focusedRequestTimeoutMs));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw const FormatException(
        'The request was not confirmed. Inspect or recover the saved conversation.',
      );
    }
    final chunks = <int>[];
    await for (final chunk in response.stream.timeout(
      const Duration(milliseconds: focusedRequestTimeoutMs),
    )) {
      chunks.addAll(chunk);
      if (chunks.length > 262144) {
        throw const FormatException('The service reply exceeded its limit.');
      }
    }
    final data = jsonDecode(utf8.decode(chunks));
    if (data is! Map<String, dynamic>) {
      throw const FormatException('Invalid focused service response.');
    }
    return data;
  }

  Future<String> create() async {
    final value = (await _request('threads', {}))['threadId'];
    if (value is! String || !_id.hasMatch(value)) {
      throw const FormatException('Invalid conversation identity.');
    }
    return value;
  }

  Map<String, dynamic> _result(Map<String, dynamic> value, String expected) {
    final surface = value['surface'];
    if (value['threadId'] != expected ||
        value['uiContract'] != 'cityside-compat-v1' ||
        value['status'] is! String ||
        value['reply'] is! String ||
        value['messages'] is! List ||
        value['next'] is! List ||
        surface is! Map<String, dynamic> ||
        surface['sessionId'] != expected ||
        surface['view'] is! Map<String, dynamic>) {
      throw const FormatException(
        'Invalid focused conversation or service panel.',
      );
    }
    for (final message in value['messages'] as List) {
      if (message is! Map ||
          !['user', 'assistant'].contains(message['role']) ||
          message['content'] is! String) {
        throw const FormatException('Invalid focused conversation.');
      }
    }
    for (final next in value['next'] as List) {
      if (next is! String) throw const FormatException('Invalid continuation.');
    }
    for (final name in ['approval', 'receipt', 'renewalApproval', 'renewal']) {
      final item = value[name];
      if (item == null) continue;
      if (item is! Map<String, dynamic> ||
          item['id'] is! String ||
          item['quote'] is! Map<String, dynamic>) {
        throw const FormatException('Invalid review.');
      }
      final quote = item['quote'] as Map<String, dynamic>;
      if (quote['amountMinor'] is! int ||
          (quote['amountMinor'] as int) <= 0 ||
          quote['currency'] != 'AED') {
        throw const FormatException('Invalid review amount.');
      }
      if (name == 'receipt' || name == 'renewal') {
        if (item['simulated'] != true) {
          throw const FormatException('Invalid simulated receipt.');
        }
      } else if (item['expiresAt'] is! int ||
          surface['revision'] != item['id']) {
        throw const FormatException('Invalid or stale approval.');
      }
      if (name == 'approval' && quote['fineIds'] is! List) {
        throw const FormatException('Invalid fine selection.');
      }
      if (name == 'renewalApproval' && quote['vehicleId'] is! String) {
        throw const FormatException('Invalid vehicle selection.');
      }
    }
    if (value['fines'] != null && value['fines'] is! List) {
      throw const FormatException('Invalid fines.');
    }
    for (final fine in (value['fines'] as List? ?? [])) {
      if (fine is! Map ||
          fine['id'] is! String ||
          fine['description'] is! String ||
          fine['amountMinor'] is! int ||
          (fine['amountMinor'] as int) <= 0) {
        throw const FormatException('Invalid fine amount.');
      }
    }
    return value;
  }

  Future<Map<String, dynamic>> inspect(String id) async {
    if (!_id.hasMatch(id)) {
      throw const FormatException('Invalid conversation identity.');
    }
    return _result(await _request('threads/$id'), id);
  }

  Future<Map<String, dynamic>> transition(
    String id,
    String action,
    Map<String, dynamic> body,
  ) async {
    if (!_id.hasMatch(id) ||
        !['messages', 'resume', 'cancel', 'recover'].contains(action)) {
      throw const FormatException('Invalid conversation action.');
    }
    return _result(await _request('threads/$id/$action', body), id);
  }

  void close() => _client.close();
}
