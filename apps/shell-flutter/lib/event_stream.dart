import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

class CitizenFrame {
  CitizenFrame(this.id, this.envelope);
  final String? id;
  final Map<String, dynamic> envelope;
}

Stream<CitizenFrame> readCitizenFrames(Stream<List<int>> source) async* {
  final lines = <String>[];
  String? id;
  var bytes = 0;
  await for (final line
      in source.transform(utf8.decoder).transform(const LineSplitter())) {
    bytes += utf8.encode(line).length;
    if (bytes > 262144) {
      throw const FormatException('Stream event exceeds limit');
    }
    if (line.isEmpty) {
      if (lines.isNotEmpty) {
        final decoded = jsonDecode(lines.join('\n'));
        if (decoded is! Map<String, dynamic>) {
          throw const FormatException('Invalid stream envelope');
        }
        yield CitizenFrame(id, decoded);
      }
      lines.clear();
      id = null;
      bytes = 0;
    } else if (line.startsWith('data:')) {
      lines.add(line.substring(5).replaceFirst(RegExp(r'^ '), ''));
    } else if (line.startsWith('id:')) {
      id = line.substring(3).trim();
      if (id.length > 128 || id.contains('\u0000')) {
        throw const FormatException('Invalid stream cursor');
      }
    }
  }
}

class CitizenEventStream {
  CitizenEventStream({
    required this.url,
    required this.sessionId,
    required this.authorization,
    required this.onEnvelope,
    required this.onStatus,
    required this.onAuthRequired,
  });
  final Uri url;
  final String sessionId;
  final Future<String> Function() authorization;
  final void Function(Map<String, dynamic>) onEnvelope;
  final void Function(String) onStatus;
  final void Function() onAuthRequired;
  bool _closed = false;
  http.Client? _client;
  Timer? _timer;
  Completer<void>? _waiting;
  String? _cursor;

  Future<void> run() async {
    var delay = 500;
    while (!_closed) {
      _client = http.Client();
      try {
        onStatus('Connecting to live updates…');
        final request = http.Request('GET', url)
          ..headers.addAll({
            'Authorization': await authorization(),
            'Accept': 'text/event-stream',
            if (_cursor != null) 'Last-Event-ID': _cursor!,
          });
        final response = await _client!.send(request);
        if (_closed) return;
        if (response.statusCode == 401 || response.statusCode == 403) {
          onAuthRequired();
          close();
          return;
        }
        if (response.statusCode == 409) {
          _cursor = null;
        } else {
          if (response.statusCode != 200) {
            throw const FormatException('Live updates unavailable');
          }
          onStatus('Live updates connected');
          delay = 500;
          await for (final frame in readCitizenFrames(response.stream)) {
            if (_closed) return;
            if (frame.envelope['sessionId'] != sessionId) {
              throw const FormatException('Stream session mismatch');
            }
            if (frame.id != null) _cursor = frame.id;
            onEnvelope(frame.envelope);
          }
        }
      } catch (_) {
        if (_closed) return;
      } finally {
        _client?.close();
        _client = null;
      }
      if (_closed) return;
      onStatus('Reconnecting live updates…');
      _waiting = Completer<void>();
      _timer = Timer(Duration(milliseconds: delay), () => _waiting?.complete());
      await _waiting!.future;
      _timer = null;
      _waiting = null;
      delay = (delay * 2).clamp(500, 10000);
    }
  }

  void close() {
    _closed = true;
    _client?.close();
    _timer?.cancel();
    if (_waiting != null && !_waiting!.isCompleted) _waiting!.complete();
  }
}
