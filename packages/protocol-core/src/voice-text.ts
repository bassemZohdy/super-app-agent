/** Speech is a concise companion to the unchanged on-screen quote, never an approval. */
export function speechText(text: string): string {
  const plain = text.replace(/```[\s\S]*?```/g, 'See the details on screen.').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link on screen').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= 480) return plain;
  const prefix = plain.slice(0, 430), boundary = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('? '), prefix.lastIndexOf('! '));
  return `${boundary > 100 ? prefix.slice(0, boundary + 1) : prefix.slice(0, prefix.lastIndexOf(' ')) + '.'} The full details are on screen.`;
}
