import { validateA2UIMessage, type A2UIMessageEnvelope } from './a2-ui.ts';

export interface StreamEvent { data: string; id?: string; event?: string; invalidId?: boolean }

/** Incremental UTF-8 SSE parser; comments, multi-line data, CR/LF and split frames. */
export async function* readEventStream(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.body) throw new Error('Stream response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', data: string[] = [], id: string | undefined;
  let event: string | undefined;
  let invalidId = false;
  let eventBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (line.length > 1_000_000) throw new Error('Stream frame exceeds client limit');
        if (!line) {
          if (data.length) yield { data: data.join('\n'), id, ...(event ? { event } : {}), ...(invalidId ? { invalidId: true } : {}) };
          data = []; id = undefined; event = undefined; invalidId = false; eventBytes = 0;
          continue;
        }
        if (line.startsWith(':')) continue;
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        const text = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
        if (field === 'data') {
          // Bound array overhead even when every data line is empty, and count
          // the newline inserted between lines in the resulting event body.
          if (data.length >= 10_000) throw new Error('Stream frame exceeds client limit');
          eventBytes += text.length + (data.length ? 1 : 0);
          data.push(text);
        }
        if (field === 'event') event = text;
        if (field === 'id') {
          invalidId = !/^[A-Za-z0-9_.:-]{0,128}$/.test(text);
          id = invalidId ? undefined : text;
        }
        if (eventBytes > 1_000_000) throw new Error('Stream frame exceeds client limit');
      }
      if (buffer.length + eventBytes > 1_000_000) throw new Error('Stream frame exceeds client limit');
      if (done) break;
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Stop waiting when closed; an uncancellable refresh may finish later but cannot start a stream. */
async function tokenOrAbort(getToken: () => string | Promise<string>, signal: AbortSignal): Promise<string | undefined> {
  let onAbort!: () => void;
  const aborted = new Promise<undefined>(resolve => {
    onAbort = () => resolve(undefined);
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => signal.aborted ? undefined : getToken()), aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

/** Tokens stay in headers. Caller supplies an in-memory token getter (including refresh). */
export async function connectEventStream(options: {
  url: string;
  sessionId: string;
  getToken: () => string | Promise<string>;
  signal: AbortSignal;
  onMessage: (message: A2UIMessageEnvelope) => void;
  onError?: (error: Error) => void;
}): Promise<void> {
  let cursor = '', delay = 500;
  const advanceCursor = (event: StreamEvent) => {
    if (event.invalidId) { cursor = ''; options.onError?.(new Error('An invalid stream cursor was discarded; the next connection will request a fresh snapshot')); }
    else if (event.id !== undefined) cursor = event.id;
  };
  while (!options.signal.aborted) {
    try {
      const token = await tokenOrAbort(options.getToken, options.signal);
      if (options.signal.aborted || token === undefined) return;
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' };
      if (cursor) headers['Last-Event-ID'] = cursor;
      const response = await fetch(options.url, { headers, signal: options.signal, cache: 'no-store', redirect: 'error' });
      if (response.status === 409 && cursor) { void response.body?.cancel().catch(() => {}); cursor = ''; continue; }
      if ([401, 403, 400].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        options.onError?.(new Error(`Stream authorization/request rejected (${response.status})`));
        return;
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
        void response.body?.cancel().catch(() => {});
        throw new Error(`Stream unavailable (${response.status})`);
      }
      for await (const event of readEventStream(response)) {
        let message: unknown;
        try { message = JSON.parse(event.data); } catch {
          // The stream resumes from the last event handled. An event that cannot be read must still move the cursor past it, or every
          // reconnect would replay the same bad event and nothing after it would ever arrive.
          advanceCursor(event);
          options.onError?.(new Error('A stream event could not be read and was skipped'));
          continue;
        }
        const validated = validateA2UIMessage(message);
        if (!validated.success || !validated.data || validated.data.sessionId !== options.sessionId) {
          advanceCursor(event);
          options.onError?.(new Error('An invalid or foreign stream event was skipped'));
          continue;
        }
        options.onMessage(validated.data);
        advanceCursor(event);
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
