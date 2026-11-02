import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { connectEventStream } from '../../packages/protocol-core/src/sse-client.ts';
import { createA2UIMessage } from '../../packages/protocol-core/src/a2-ui.ts';

test('foreign and malformed events are skipped and reconnect resumes past them', async t => {
  const cursors: Array<string | undefined> = [], delivered: number[] = [];
  const server = http.createServer((request, response) => {
    cursors.push(request.headers['last-event-id'] as string | undefined);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (cursors.length === 1) response.end('id: 1\ndata: {"id":"event-1","type":"A2UI_STREAM_DELTA","timestamp":1,"data":{"phase":"TOOL_EXECUTION","text":"test"},"sessionId":"mine","n":1}\n\nid: 2\ndata: {"id":"event-1","type":"A2UI_STREAM_DELTA","timestamp":1,"data":{"phase":"TOOL_EXECUTION","text":"test"},"sessionId":"other","n":2}\n\nid: 3\ndata: null\n\n');
    else response.end('id: 4\ndata: {"id":"event-1","type":"A2UI_STREAM_DELTA","timestamp":1,"data":{"phase":"TOOL_EXECUTION","text":"test"},"sessionId":"mine","n":4}\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  try {
    await connectEventStream({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/stream`, sessionId: 'mine', getToken: () => 'test', signal: controller.signal,
      onMessage: message => { delivered.push((message as unknown as { n: number }).n); if (delivered.includes(4)) controller.abort(); } });
  } finally { clearTimeout(timer); }
  assert.deepEqual(delivered, [1, 4]);
  assert.deepEqual(cursors, [undefined, '3']);
});

test('malformed same-session messages cannot block subsequent stream events', async t => {
  const cursors: Array<string | undefined> = [], delivered: string[] = [], errors: string[] = [];
  const delta = (text: string) => JSON.stringify(createA2UIMessage('A2UI_STREAM_DELTA', 'mine', { phase: 'TOOL_EXECUTION', text }));
  const server = http.createServer((request, response) => {
    cursors.push(request.headers['last-event-id'] as string | undefined);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (cursors.length === 1) response.end(`id: 1\ndata: ${delta('first')}\n\nid: 2\ndata: {"sessionId":"mine","type":"A2UI_STREAM_DELTA","data":null}\n\n`);
    else response.end(`id: 3\ndata: ${delta('last')}\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  try {
    await connectEventStream({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/stream`, sessionId: 'mine', getToken: () => 'test', signal: controller.signal,
      onMessage: message => { delivered.push(message.data.text); if (message.data.text === 'last') controller.abort(); },
      onError: error => errors.push(error.message) });
  } finally { clearTimeout(timer); }
  assert.deepEqual(delivered, ['first', 'last']);
  assert.deepEqual(cursors, [undefined, '2']);
  assert.ok(errors.some(error => /skipped/i.test(error)));
});
