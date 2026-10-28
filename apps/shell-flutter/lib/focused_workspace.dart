import 'package:flutter/material.dart';

import 'focused_client.dart';
import 'shared/browser_auth.dart';
import 'workspace_panes.dart';
import 'theme/tokens.g.dart';

class FocusedWorkspace extends StatefulWidget {
  const FocusedWorkspace({super.key});
  @override
  State<FocusedWorkspace> createState() => _FocusedWorkspaceState();
}

class _FocusedWorkspaceState extends State<FocusedWorkspace> {
  final token = TextEditingController();
  final draft = TextEditingController();
  FocusedClient? client;
  Map<String, dynamic>? data;
  bool pending = false, uncertain = false;
  String error = '';
  Map<String, dynamic>? get active =>
      (data?['approval'] ?? data?['renewalApproval']) as Map<String, dynamic>?;
  bool get needsRecovery =>
      uncertain ||
      data?['status'] == 'unknown' ||
      ((data?['next'] as List? ?? []).isNotEmpty && active == null);
  bool get canMessage =>
      client != null &&
      !pending &&
      !needsRecovery &&
      active == null &&
      data?['status'] != 'cancelled';
  Future<void> run(
    Future<void> Function() operation, {
    bool mutation = false,
  }) async {
    if (pending) return;
    setState(() {
      pending = true;
      error = '';
    });
    try {
      await operation();
    } catch (_) {
      if (mounted) {
        setState(() {
          if (mutation) uncertain = true;
          error = 'The result was not confirmed. Inspect or recover the saved conversation before continuing.';
        });
      }
    } finally {
      if (mounted) setState(() => pending = false);
    }
  }

  Future<void> signIn() async {
    final value = token.text.trim();
    token.clear();
    if (value.isEmpty) return;
    await run(() async {
      final next = FocusedClient(value);
      try {
        final saved = readBrowserConversation('focused');
        final id = saved.isEmpty ? await next.create() : saved;
        final result = await next.inspect(id);
        if (!mounted) {
          next.close();
          return;
        }
        writeBrowserConversation('focused', id);
        setState(() {
          client = next;
          data = result;
          uncertain = false;
        });
      } catch (_) {
        next.close();
        rethrow;
      }
    });
  }

  Future<void> transition(
    String action, [
    Map<String, dynamic> body = const {},
  ]) async {
    if (client == null || data == null) return;
    await run(() async {
      final result = await client!.transition(
        data!['threadId'] as String,
        action,
        body,
      );
      if (mounted) {
        setState(() {
          data = result;
          uncertain = false;
          if (action == 'messages') draft.clear();
        });
      }
    }, mutation: true);
  }

  Future<void> inspect() async {
    if (client != null && data != null) {
      await run(() async {
        final result = await client!.inspect(data!['threadId'] as String);
        if (mounted) setState(() => data = result);
      });
    }
  }

  Future<void> start() async {
    if (client != null) {
      await run(() async {
        final id = await client!.create();
        final result = await client!.inspect(id);
        if (mounted) {
          setState(() {
            data = result;
            uncertain = false;
            draft.clear();
            writeBrowserConversation('focused', id);
          });
        }
      });
    }
  }

  void decide(String decision) {
    if (active != null && !needsRecovery && !pending) {
      transition('resume', {'approvalId': active!['id'], 'decision': decision});
    }
  }

  @override
  void dispose() {
    client?.close();
    token.dispose();
    draft.dispose();
    super.dispose();
  }

  String amount(int minor) =>
      'AED ${minor ~/ 100}.${(minor % 100).toString().padLeft(2, '0')}';
  ButtonStyle reviewButtonStyle({required bool primary}) {
    const size = Size(
      CitysideTokens.spaceLarge * 2,
      CitysideTokens.spaceLarge * 2,
    );
    final base = primary
        ? FilledButton.styleFrom(
            minimumSize: size,
            visualDensity: VisualDensity.standard,
          )
        : TextButton.styleFrom(
            minimumSize: size,
            visualDensity: VisualDensity.standard,
          );
    return base.copyWith(
      side: WidgetStateProperty.resolveWith((states) {
        if (!states.contains(WidgetState.focused)) return null;
        return BorderSide(
          color: Theme.of(context).brightness == Brightness.dark
              ? CitysideTokens.darkFocusRing
              : CitysideTokens.focusRing,
          width: 3,
        );
      }),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Fines & vehicle renewal'),
      actions: [
        if (client != null)
          TextButton(
            onPressed: pending
                ? null
                : () {
                    client!.close();
                    setState(() {
                      client = null;
                      data = null;
                      uncertain = false;
                      draft.clear();
                    });
                  },
            child: const Text('Sign out'),
          ),
      ],
    ),
    body: Column(
      children: [
        if (error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Semantics(
              liveRegion: true,
              child: Text(
                error,
                style: const TextStyle(color: CitysideTokens.dangerText),
              ),
            ),
          ),
        if (pending) const LinearProgressIndicator(),
        if (client == null)
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) => SingleChildScrollView(
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 520),
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Text(
                              'Your fines. Your decision.',
                              style: TextStyle(fontSize: 28),
                            ),
                            const Text(
                              'Demo records and payments are simulated. Review the exact amount before confirming.',
                            ),
                            TextField(
                              controller: token,
                              obscureText: true,
                              enabled: !pending,
                              decoration: InputDecoration(
                                labelText: 'Access token',
                                focusedBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(
                                    CitysideTokens.radiusMd,
                                  ),
                                  borderSide: BorderSide(
                                    color:
                                        Theme.of(context).brightness ==
                                            Brightness.dark
                                        ? CitysideTokens.darkFocusRing
                                        : CitysideTokens.focusRing,
                                    width: 3,
                                  ),
                                ),
                              ),
                              onSubmitted: (_) => signIn(),
                            ),
                            FilledButton(
                              style: FilledButton.styleFrom(
                                visualDensity: VisualDensity.standard,
                                minimumSize: const Size(
                                  CitysideTokens.spaceLarge * 2,
                                  CitysideTokens.spaceLarge * 2,
                                ),
                              ),
                              onPressed: pending ? null : signIn,
                              child: const Text('Open my fines'),
                            ),
                            TextButton(
                              style: TextButton.styleFrom(
                                visualDensity: VisualDensity.standard,
                                minimumSize: const Size(
                                  CitysideTokens.spaceLarge * 2,
                                  CitysideTokens.spaceLarge * 2,
                                ),
                              ),
                              onPressed: pending
                                  ? null
                                  : () {
                                      writeBrowserConversation('focused', '');
                                      setState(
                                        () => error = 'Saved reference cleared. Sign in to start a new conversation.',
                                      );
                                    },
                              child: const Text(
                                'Forget saved conversation reference',
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        if (client != null) ...[
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                TextButton(
                  onPressed: pending || active != null || needsRecovery
                      ? null
                      : start,
                  child: const Text('Start a new conversation'),
                ),
                TextButton(
                  onPressed: pending ? null : inspect,
                  child: const Text('Inspect saved conversation'),
                ),
                TextButton(
                  onPressed: pending ? null : () => transition('recover'),
                  child: const Text('Recover saved operation'),
                ),
              ],
            ),
          ),
          Expanded(
            child: WorkspacePanes(
              conversation: conversation(),
              details: details(),
              revealDetailsKey: active?['id'] as String?,
            ),
          ),
        ],
      ],
    ),
  );
  Widget conversation() => LayoutBuilder(
    builder: (context, constraints) => Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          Expanded(
            child: ListView(
              children: [
                for (final message in (data?['messages'] as List? ?? []))
                  ListTile(
                    title: Text(message['role'] == 'user' ? 'You' : 'Rashid'),
                    subtitle: SelectableText(message['content'] as String),
                  ),
                if ((data?['reply'] as String? ?? '').isNotEmpty)
                  Text(data!['reply'] as String),
                if (needsRecovery)
                  const Text(
                    'Inspect and recover the original operation before continuing.',
                  ),
              ],
            ),
          ),
          ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight:
                  (constraints.maxHeight - 24).clamp(0, double.infinity) * .85,
            ),
            child: SingleChildScrollView(
              child: Column(
                children: [
                  TextField(
                    controller: draft,
                    enabled: canMessage,
                    maxLength: 2000,
                    minLines: 1,
                    maxLines: 3,
                    decoration: InputDecoration(
                      labelText: 'Message about fines',
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(
                          CitysideTokens.radiusMd,
                        ),
                        borderSide: BorderSide(
                          color: Theme.of(context).brightness == Brightness.dark
                              ? CitysideTokens.darkFocusRing
                              : CitysideTokens.focusRing,
                          width: 3,
                        ),
                      ),
                    ),
                    onSubmitted: (value) {
                      if (canMessage && value.trim().isNotEmpty) {
                        transition('messages', {'message': value.trim()});
                      }
                    },
                  ),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        FilledButton(
                          style: FilledButton.styleFrom(
                            visualDensity: VisualDensity.standard,
                            minimumSize: const Size(
                              CitysideTokens.spaceLarge * 2,
                              CitysideTokens.spaceLarge * 2,
                            ),
                          ),
                          onPressed: canMessage
                              ? () {
                                  if (draft.text.trim().isNotEmpty) {
                                    transition('messages', {
                                      'message': draft.text.trim(),
                                    });
                                  }
                                }
                              : null,
                          child: const Text('Send message'),
                        ),
                        TextButton(
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.standard,
                            minimumSize: const Size(
                              CitysideTokens.spaceLarge * 2,
                              CitysideTokens.spaceLarge * 2,
                            ),
                          ),
                          onPressed: canMessage
                              ? () => transition('messages', {
                                  'message': 'Show outstanding fines',
                                })
                              : null,
                          child: const Text('Show outstanding fines'),
                        ),
                        TextButton(
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.standard,
                            minimumSize: const Size(
                              CitysideTokens.spaceLarge * 2,
                              CitysideTokens.spaceLarge * 2,
                            ),
                          ),
                          onPressed: canMessage
                              ? () => transition('messages', {
                                  'message': 'Pay my outstanding fines',
                                })
                              : null,
                          child: const Text('Review payment'),
                        ),
                        TextButton(
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.standard,
                            minimumSize: const Size(
                              CitysideTokens.spaceLarge * 2,
                              CitysideTokens.spaceLarge * 2,
                            ),
                          ),
                          onPressed: canMessage
                              ? () => transition('messages', {
                                  'message': 'Renew my car registration',
                                })
                              : null,
                          child: const Text('Renew vehicle registration'),
                        ),
                        TextButton(
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.standard,
                            minimumSize: const Size(
                              CitysideTokens.spaceLarge * 2,
                              CitysideTokens.spaceLarge * 2,
                            ),
                          ),
                          onPressed:
                              pending ||
                                  needsRecovery ||
                                  data?['status'] == 'cancelled'
                              ? null
                              : () => transition('cancel'),
                          child: const Text('Cancel conversation'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );
  Widget details() => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      Text(
        data?['renewalApproval'] != null
            ? 'Review before you renew'
            : active != null
            ? 'Review before you pay'
            : 'Your fines',
        style: const TextStyle(fontSize: 24),
      ),
      for (final fine in (data?['fines'] as List? ?? []))
        ListTile(
          title: Text(fine['id'] as String),
          subtitle: Text(fine['description'] as String),
          trailing: Text(amount(fine['amountMinor'] as int)),
        ),
      if (active != null) ...[
        Text(
          'Simulated total: ${amount(active!['quote']['amountMinor'] as int)}',
        ),
        Text(
          'Review expires at ${DateTime.fromMillisecondsSinceEpoch(active!['expiresAt'] as int).toLocal()}. Typed “yes” does not confirm.',
        ),
        FilledButton(
          style: reviewButtonStyle(primary: true),
          onPressed: pending || needsRecovery ? null : () => decide('approve'),
          child: Text(
            data?['renewalApproval'] != null
                ? 'Confirm simulated renewal'
                : 'Confirm simulated payment',
          ),
        ),
        TextButton(
          style: reviewButtonStyle(primary: false),
          onPressed: pending || needsRecovery ? null : () => decide('reject'),
          child: Text(
            data?['renewalApproval'] != null
                ? 'Reject renewal'
                : 'Reject payment',
          ),
        ),
        TextButton(
          style: reviewButtonStyle(primary: false),
          onPressed: pending || needsRecovery ? null : () => decide('cancel'),
          child: const Text('Cancel review'),
        ),
      ],
      if (data?['receipt'] != null) ...[
        const Text('Your simulated receipt'),
        Text(amount(data!['receipt']['quote']['amountMinor'] as int)),
        SelectableText(data!['receipt']['id'] as String),
      ],
      if (data?['renewal'] != null) ...[
        const Text('Your simulated renewal'),
        Text(amount(data!['renewal']['quote']['amountMinor'] as int)),
        SelectableText(data!['renewal']['id'] as String),
      ],
    ],
  );
}
