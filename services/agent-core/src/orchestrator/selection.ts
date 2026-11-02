type Message = { role: 'user' | 'assistant'; content: string };

/** Resolve explicit references from the current user turn, or its immediate predecessor for a supported follow-up. */
export function selectedFines(messages: Message[]): string[] {
  const userTurns = messages.filter(message => message.role === 'user');
  const current = userTurns.at(-1)?.content || '';
  const references = (text: string) => [...new Set((text.match(/\bfine-[a-z0-9_-]+/gi) || []).map(id => id.replace(/^fine-/i, 'fine-')))];
  const selected = references(current);
  if (selected.length || !/\bpay\s+(?:them|it)\b|أريد\s+دفعها/i.test(current)) return selected;
  return references(userTurns.at(-2)?.content || '');
}
