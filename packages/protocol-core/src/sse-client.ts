import type { A2UIMessageEnvelope } from './a2-ui.ts';

export interface StreamEvent { data: string; id?: string; event?: string }

/** Incremental UTF-8 SSE parser; comments, multi-line data, CR/LF and split frames. */
export async function* readEventStream(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.body) throw new Error('Stream response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', data: string[] = [], id: string | undefined;
  let event: string | undefined;
  let eventBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length + eventBytes > 1_000_000) throw new Error('Stream frame exceeds client limit');
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (!line) {
          if (data.length) yield { data: data.join('\n'), id, ...(event ? { event } : {}) };
          data = []; id = undefined; event = undefined; eventBytes = 0;
          continue;
        }
        if (line.startsWith(':')) continue;
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        const text = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
        if (field === 'data') { data.push(text); eventBytes += text.length; }
        if (field === 'event') event = text;
        if (field === 'id' && !text.includes('\0')) id = text;
        if (eventBytes > 1_000_000) throw new Error('Stream frame exceeds client limit');
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Tokens stay in headers. Caller supplies an in-memory token getter (including refresh). */
export async function connectEventStream(options: {
  url: string;
  getToken: () => string | Promise<string>;
  signal: AbortSignal;
  onMessage: (message: A2UIMessageEnvelope) => void;
  onError?: (error: Error) => void;
}): Promise<void> {
  let cursor = '', delay = 500;
  while (!options.signal.aborted) {
    try {
      const token = await options.getToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' };
      if (cursor) headers['Last-Event-ID'] = cursor;
      const response = await fetch(options.url, { headers, signal: options.signal, cache: 'no-store', redirect: 'error' });
      if (response.status === 409 && cursor) { cursor = ''; continue; }
      if ([401, 403, 400].includes(response.status)) {
        options.onError?.(new Error(`Stream authorization/request rejected (${response.status})`));
        return;
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error(`Stream unavailable (${response.status})`);
      }
      for await (const event of readEventStream(response)) {
        const message: A2UIMessageEnvelope = JSON.parse(event.data);
        options.onMessage(message);
        if (event.id !== undefined) cursor = event.id;
        delay = 500;
      }
    } catch (error) {
      if (options.signal.aborted) return;
      options.onError?.(error instanceof Error ? error : new Error('Stream failed'));
    }
    if (options.signal.aborted) return;
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); options.signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, delay);
      options.signal.addEventListener('abort', finish, { once: true });
    });
    delay = Math.min(delay * 2, 10_000);
  }
}
