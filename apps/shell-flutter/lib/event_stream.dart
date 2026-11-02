import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

class CitizenFrame {
  CitizenFrame(
    this.id,
    this.envelope, {
    this.unreadable = false,
    this.invalidId = false,
  });
  final String? id;
  final Map<String, dynamic> envelope;

  /// The event's data was not a JSON object. It is still reported, with its id, so the stream can move its cursor past it.
  final bool unreadable;
  final bool invalidId;
}

// Split UTF-8 lines without buffering an unlimited unterminated line.
Stream<String> _boundedLines(Stream<List<int>> source) async* {
  final bytes = <int>[];
  var afterCarriageReturn = false;
  await for (final chunk in source) {
    for (final byte in chunk) {
      if (afterCarriageReturn) {
        afterCarriageReturn = false;
        if (byte == 10) continue;
      }
      if (byte == 10 || byte == 13) {
        yield utf8.decode(bytes);
        bytes.clear();
        afterCarriageReturn = byte == 13;
      } else {
        if (bytes.length >= 262144) {
          throw const FormatException('Stream event exceeds limit');
        }
        bytes.add(byte);
      }
    }
  }
  if (bytes.isNotEmpty) yield utf8.decode(bytes);
}

Stream<CitizenFrame> readCitizenFrames(Stream<List<int>> source) async* {
  final lines = <String>[];
  String? id;
  var invalidId = false;
  var bytes = 0;
  await for (final line in _boundedLines(source)) {
    bytes += utf8.encode(line).length;
    if (bytes > 262144) {
      throw const FormatException('Stream event exceeds limit');
    }
    if (line.isEmpty) {
      if (lines.isNotEmpty) {
        Object? decoded;
        try {
          decoded = jsonDecode(lines.join('\n'));
        } on FormatException {
          decoded = null;
        }
        yield decoded is Map<String, dynamic>
            ? CitizenFrame(id, decoded, invalidId: invalidId)
            : CitizenFrame(
                id,
                const {},
                unreadable: true,
                invalidId: invalidId,
              );
      }
      lines.clear();
      id = null;
      invalidId = false;
      bytes = 0;
    } else if (line.startsWith('data:')) {
      lines.add(line.substring(5).replaceFirst(RegExp(r'^ '), ''));
    } else if (line == 'id' || line.startsWith('id:')) {
      final value = line == 'id'
          ? ''
          : line.substring(3).replaceFirst(RegExp(r'^ '), '');
      invalidId = !RegExp(r'^[A-Za-z0-9_.:-]{0,128}$').hasMatch(value);
      id = invalidId ? null : value;
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
  final StreamController<void> _closeEvents = StreamController<void>.broadcast(
    sync: true,
  );
  http.Client? _client;
  Timer? _timer;
  Completer<void>? _waiting;
  String? _cursor;

  Future<T?> _untilClosed<T>(Future<T> operation) async {
    if (_closed) return null;
    final closed = Completer<T?>();
    final listener = _closeEvents.stream.listen((_) => closed.complete(null));
    try {
      return await Future.any<T?>([operation, closed.future]);
    } finally {
      unawaited(listener.cancel());
    }
  }

  Future<void> run() async {
    var delay = 500;
    while (!_closed) {
      _client = http.Client();
      try {
        onStatus('Connecting to live updates…');
        if (_closed) return;
        final token = await _untilClosed(Future<String>.sync(authorization));
        if (_closed || token == null) return;
        final request = http.Request('GET', url)
          ..headers.addAll({
            'Authorization': token,
            'Accept': 'text/event-stream',
            if (_cursor != null) 'Last-Event-ID': _cursor!,
          });
        final responseFuture = _client!.send(request).then((response) {
          if (_closed) {
            unawaited(response.stream.listen(null).cancel().catchError((_) {}));
            return null;
          }
          return response;
        });
        final response = await _untilClosed(responseFuture);
        if (_closed || response == null) {
          if (response != null) {
            unawaited(response.stream.listen(null).cancel().catchError((_) {}));
          }
          return;
        }
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
          if (_closed) {
            unawaited(response.stream.listen(null).cancel().catchError((_) {}));
            return;
          }
          delay = 500;
          late StreamSubscription<List<int>> source;
          final relay = StreamController<List<int>>(
            sync: true,
            onPause: () => source.pause(),
            onResume: () => source.resume(),
          );
          source = response.stream.listen(
            relay.add,
            onError: relay.addError,
            onDone: relay.close,
          );
          final frames = StreamIterator(readCitizenFrames(relay.stream));
          try {
            while (!_closed) {
              final available = await _untilClosed(frames.moveNext());
              if (_closed || available != true) break;
              final frame = frames.current;
              if (frame.unreadable ||
                  frame.envelope['sessionId'] != sessionId) {
                // An event that cannot be read, or that belongs to another session, is skipped. The cursor still moves past it, or every
                // reconnect would replay the same event and nothing after it would arrive.
                if (frame.invalidId || frame.id == '') {
                  _cursor = null;
                } else if (frame.id != null) {
                  _cursor = frame.id;
                }
                continue;
              }
              onEnvelope(frame.envelope);
              if (frame.invalidId || frame.id == '') {
                _cursor = null;
              } else if (frame.id != null) {
                _cursor = frame.id;
              }
            }
          } finally {
            unawaited(source.cancel().catchError((_) {}));
            unawaited(frames.cancel().catchError((_) {}));
            unawaited(relay.close().catchError((_) {}));
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
      if (_closed) return;
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
    if (!_closeEvents.isClosed) {
      _closeEvents.add(null);
      unawaited(_closeEvents.close());
    }
    _client?.close();
    _timer?.cancel();
    if (_waiting != null && !_waiting!.isCompleted) _waiting!.complete();
  }
}
