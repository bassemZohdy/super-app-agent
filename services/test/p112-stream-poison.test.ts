import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { connectEventStream } from '../../packages/protocol-core/src/sse-client.ts';

// P1-12: one bad event in a stream must not stop the good ones. The stream resumes from the last event it handled, so an event the
// client cannot read must still move the cursor past it; otherwise every reconnect replays the same bad event and nothing after it is
// ever delivered.
const message = (n: number) => JSON.stringify({ id: 'event', type: 'A2UI_STREAM_DELTA', timestamp: 1, data: { phase: 'TOOL_EXECUTION', text: 'test' }, sessionId: 'session_1', n });

test('P1-12: an unreadable event in the stream is skipped and the events after it are delivered', async t => {
  const resumedFrom: (string | undefined)[] = [];
  const server = http.createServer((request, response) => {
    const from = request.headers['last-event-id'] as string | undefined;
    resumedFrom.push(from);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const events: [number, string][] = [[1, message(1)], [2, '{ this is not json'], [3, message(3)]];
    for (const [id, data] of events) if (!from || id > Number(from)) response.write(`id: ${id}\ndata: ${data}\n\n`);
    // Keep the stream open: a real stream does not end after a bad event.
    request.on('close', () => response.end());
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { port } = server.address() as AddressInfo;

  const delivered: number[] = [], errors: string[] = [];
  const controller = new AbortController();
  const done = connectEventStream({
    url: `http://127.0.0.1:${port}/stream`, sessionId: 'session_1', getToken: () => 'token', signal: controller.signal,
    onMessage: envelope => delivered.push((envelope as unknown as { n: number }).n),
    onError: error => errors.push(error.message),
  });
  const deadline = Date.now() + 4000;
  while (!delivered.includes(3) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  controller.abort();
  await done;

  assert.deepEqual(delivered, [1, 3], `the good events before and after the bad one arrive once each (errors: ${errors.join('; ')}, resumed from: ${resumedFrom.join(',')})`);
  assert.ok(errors.length >= 1, 'the unreadable event is reported');
  assert.ok(resumedFrom.length <= 2, `the bad event does not cause a reconnect loop (${resumedFrom.length} connections)`);
});
