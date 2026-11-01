import 'package:flutter/material.dart';

import 'focused_client.dart';
import 'shared/browser_auth.dart';
import 'shared/locale.dart';
import 'workspace_panes.dart';
import 'theme/tokens.g.dart';

class FocusedWorkspace extends StatefulWidget {
  const FocusedWorkspace({super.key});
  @override
  State<FocusedWorkspace> createState() => _FocusedWorkspaceState();
}

class _FocusedWorkspaceState extends State<FocusedWorkspace> {
  final String locale = readBrowserLocale().toLowerCase().startsWith('ar')
      ? 'ar'
      : 'en';
  String t(String key, [Map<String, Object> values = const {}]) =>
      citysideText(locale, key, values);
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
          error = t('fines.unconfirmed');
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
  Widget build(BuildContext context) => Directionality(
    textDirection: locale == 'ar' ? TextDirection.rtl : TextDirection.ltr,
    child: Scaffold(
      appBar: AppBar(
        title: Text(t('fines.title')),
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
              child: Text(t('fines.signOut')),
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
                    constraints: BoxConstraints(
                      minHeight: constraints.maxHeight,
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 520),
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                t('fines.headline'),
                                style: const TextStyle(fontSize: 28),
                              ),
                              Text(t('fines.simulatedReview')),
                              TextField(
                                controller: token,
                                obscureText: true,
                                enabled: !pending,
                                decoration: InputDecoration(
                                  labelText: t('fines.token'),
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
                                child: Text(t('fines.open')),
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
                                          () => error = t('fines.cleared'),
                                        );
                                      },
                                child: Text(t('fines.forget')),
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
                    child: Text(t('fines.start')),
                  ),
                  TextButton(
                    onPressed: pending ? null : inspect,
                    child: Text(t('fines.inspect')),
                  ),
                  TextButton(
                    onPressed: pending ? null : () => transition('recover'),
                    child: Text(t('fines.recover')),
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
                    title: Text(
                      message['role'] == 'user'
                          ? t('fines.you')
                          : t('fines.assistant'),
                    ),
                    subtitle: SelectableText(message['content'] as String),
                  ),
                if ((data?['reply'] as String? ?? '').isNotEmpty)
                  Text(data!['reply'] as String),
                if (needsRecovery) Text(t('fines.needRecovery')),
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
                      labelText: t('fines.messageLabel'),
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
                          child: Text(t('fines.send')),
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
                          child: Text(t('fines.showOutstanding')),
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
                          child: Text(t('fines.reviewPayment')),
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
                          child: Text(t('fines.renew')),
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
                          child: Text(t('fines.cancelConversation')),
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
            ? t('fines.reviewRenew')
            : active != null
            ? t('fines.reviewPay')
            : t('fines.yourFines'),
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
          '${t('fines.total')} ${amount(active!['quote']['amountMinor'] as int)}',
        ),
        Text(
          t('fines.expires', {
            'time':
                '${DateTime.fromMillisecondsSinceEpoch(active!['expiresAt'] as int).toLocal()}',
          }),
        ),
        FilledButton(
          style: reviewButtonStyle(primary: true),
          onPressed: pending || needsRecovery ? null : () => decide('approve'),
          child: Text(
            data?['renewalApproval'] != null
                ? t('fines.confirmRenewal')
                : t('fines.confirmPayment'),
          ),
        ),
        TextButton(
          style: reviewButtonStyle(primary: false),
          onPressed: pending || needsRecovery ? null : () => decide('reject'),
          child: Text(
            data?['renewalApproval'] != null
                ? t('fines.rejectRenewal')
                : t('fines.rejectPayment'),
          ),
        ),
        TextButton(
          style: reviewButtonStyle(primary: false),
          onPressed: pending || needsRecovery ? null : () => decide('cancel'),
          child: Text(t('fines.cancelReview')),
        ),
      ],
      if (data?['receipt'] != null) ...[
        Text(t('fines.receipt')),
        Text(amount(data!['receipt']['quote']['amountMinor'] as int)),
        SelectableText(data!['receipt']['id'] as String),
      ],
      if (data?['renewal'] != null) ...[
        Text(t('fines.renewalDone')),
        Text(amount(data!['renewal']['quote']['amountMinor'] as int)),
        SelectableText(data!['renewal']['id'] as String),
      ],
    ],
  );
}
