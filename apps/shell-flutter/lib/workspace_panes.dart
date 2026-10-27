import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme/tokens.g.dart';
import 'shared/browser_auth.dart';

/// Shared interaction contract: equal initial panes, bounded resizing, swap and size toggles.
class WorkspacePanes extends StatefulWidget {
  const WorkspacePanes({
    super.key,
    required this.conversation,
    required this.details,
    this.revealDetailsKey,
  });
  final Widget conversation;
  final Widget details;
  final String? revealDetailsKey;
  @override
  State<WorkspacePanes> createState() => _WorkspacePanesState();
}

class _WorkspacePanesState extends State<WorkspacePanes> {
  bool conversationFirst = true;
  bool mobileConversation = true;
  String? maximized;
  double split = .5;
  @override
  void didUpdateWidget(covariant WorkspacePanes oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.revealDetailsKey != null &&
        widget.revealDetailsKey != oldWidget.revealDetailsKey) {
      maximized = null;
      mobileConversation = false;
    }
  }

  Widget pane(bool conversation) {
    final id = conversation ? 'conversation' : 'service details';
    return Semantics(
      container: true,
      label: '$id pane',
      child: Column(
        key: ValueKey(id),
        children: [
          Container(
            decoration: const BoxDecoration(
              border: Border(
                bottom: BorderSide(color: CitysideTokens.surfaceBorder),
              ),
            ),
            child: Row(
              children: [
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    conversation ? 'Conversation' : 'Service details',
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ),
                if (conversation)
                  IconButton(
                    tooltip: 'Swap panes',
                    onPressed: () => setState(() {
                      conversationFirst = !conversationFirst;
                      maximized = null;
                    }),
                    icon: const Icon(Icons.swap_horiz),
                  ),
                IconButton(
                  tooltip: '${maximized == id ? 'Restore' : 'Maximize'} $id',
                  onPressed: () => setState(() {
                    maximized = maximized == id ? null : id;
                    mobileConversation = conversation;
                  }),
                  icon: Icon(
                    maximized == id
                        ? Icons.fullscreen_exit
                        : Icons.open_in_full,
                  ),
                ),
              ],
            ),
          ),
          Expanded(child: conversation ? widget.conversation : widget.details),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final features = MediaQuery.of(context).displayFeatures
          .where(
            (feature) => feature.bounds.width > 0 || feature.bounds.height > 0,
          )
          .toList();
      final browserHinge = readBrowserHinge();
      final Rect? hingeBounds = features.isNotEmpty
          ? features.first.bounds
          : browserHinge == null
          ? null
          : browserHinge['vertical'] == true
          ? Rect.fromLTWH(
              (browserHinge['start'] as num).toDouble(),
              0,
              ((browserHinge['end'] as num) - (browserHinge['start'] as num))
                  .toDouble(),
              MediaQuery.sizeOf(context).height,
            )
          : Rect.fromLTWH(
              0,
              (browserHinge['start'] as num).toDouble(),
              MediaQuery.sizeOf(context).width,
              ((browserHinge['end'] as num) - (browserHinge['start'] as num))
                  .toDouble(),
            );
      if (hingeBounds != null) {
        final hinge = hingeBounds;
        final vertical = hinge.height > hinge.width;
        final top = MediaQuery.sizeOf(context).height - constraints.maxHeight;
        final firstSize = vertical ? hinge.left : hinge.top - top;
        final gap = vertical ? hinge.width : hinge.height;
        final total = vertical ? constraints.maxWidth : constraints.maxHeight;
        if (firstSize > 0 && firstSize + gap < total) {
          return Flex(
            direction: vertical ? Axis.horizontal : Axis.vertical,
            children: [
              SizedBox(
                width: vertical ? firstSize : null,
                height: vertical ? null : firstSize,
                child: pane(
                  maximized == null
                      ? conversationFirst
                      : maximized == 'conversation',
                ),
              ),
              SizedBox(
                width: vertical ? gap : null,
                height: vertical ? null : gap,
              ),
              if (maximized == null) Expanded(child: pane(!conversationFirst)),
            ],
          );
        }
      }
      if (maximized != null) return pane(maximized == 'conversation');
      if (constraints.maxWidth < 680) {
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(8),
              child: SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(
                    value: true,
                    icon: Icon(Icons.chat_bubble_outline),
                    label: Text('Chat'),
                  ),
                  ButtonSegment(
                    value: false,
                    icon: Icon(Icons.explore_outlined),
                    label: Text('Service details'),
                  ),
                ],
                selected: {mobileConversation},
                onSelectionChanged: (values) =>
                    setState(() => mobileConversation = values.first),
              ),
            ),
            Expanded(child: pane(mobileConversation)),
          ],
        );
      }
      final width = constraints.maxWidth - 24;
      final minimum = math.max(.25, math.min(.45, 280 / width));
      void resize(double left) => setState(() {
        final value = left.clamp(minimum, 1 - minimum);
        split = conversationFirst ? value : 1 - value;
      });
      final visibleSplit = split.clamp(minimum, 1 - minimum);
      final left = conversationFirst ? visibleSplit : 1 - visibleSplit;
      return Row(
        children: [
          Expanded(
            flex: (left * 10000).round(),
            child: pane(conversationFirst),
          ),
          CallbackShortcuts(
            bindings: {
              const SingleActivator(LogicalKeyboardKey.arrowLeft): () =>
                  resize(left - .05),
              const SingleActivator(LogicalKeyboardKey.arrowRight): () =>
                  resize(left + .05),
              const SingleActivator(LogicalKeyboardKey.home): () =>
                  resize(minimum),
              const SingleActivator(LogicalKeyboardKey.end): () =>
                  resize(1 - minimum),
              const SingleActivator(LogicalKeyboardKey.enter): () =>
                  setState(() => split = .5),
            },
            child: Focus(
              child: Semantics(
                label: 'Resize conversation and service details',
                value: '${(visibleSplit * 100).round()}% conversation',
                increasedValue:
                    '${((visibleSplit + .05).clamp(minimum, 1 - minimum) * 100).round()}% conversation',
                decreasedValue:
                    '${((visibleSplit - .05).clamp(minimum, 1 - minimum) * 100).round()}% conversation',
                onIncrease: () =>
                    resize(left + (conversationFirst ? .05 : -.05)),
                onDecrease: () =>
                    resize(left - (conversationFirst ? .05 : -.05)),
                child: MouseRegion(
                  cursor: SystemMouseCursors.resizeLeftRight,
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onHorizontalDragUpdate: (details) => resize(
                      (conversationFirst ? split : 1 - split) +
                          details.delta.dx / width,
                    ),
                    onDoubleTap: () => setState(() => split = .5),
                    child: SizedBox(
                      width: 24,
                      height: constraints.maxHeight,
                      child: const Icon(
                        Icons.drag_indicator,
                        size: 20,
                        color: CitysideTokens.textMuted,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            flex: ((1 - left) * 10000).round(),
            child: pane(!conversationFirst),
          ),
        ],
      );
    },
  );
}
