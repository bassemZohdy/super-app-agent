import { createHash } from 'node:crypto';
import { BaseCheckpointSaver, type Checkpoint, type CheckpointMetadata, type CheckpointTuple } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import { redisSessions } from '../session-store.ts';

type Packed = { type: string; data: string };
/** Redis saver for the demo's single-namespace, bounded approval graph. */
export class RedisGraphSaver extends BaseCheckpointSaver {
  private async store() { const store = redisSessions(); if (!store) throw new Error('Redis checkpoints require Redis sessions'); await store.connect(); return store; }
  private key(config: RunnableConfig) {
    const { thread_id, checkpoint_ns = '' } = config.configurable || {};
    if (typeof thread_id !== 'string' || !thread_id || checkpoint_ns !== '') throw new Error('Invalid demo checkpoint thread');
    return `superapp:graph:${createHash('sha256').update(thread_id).digest('hex')}`;
  }
  private async pack(value: unknown): Promise<Packed> { const [type, bytes] = await this.serde.dumpsTyped(value); if (bytes.byteLength > 1048576) throw new Error('Checkpoint size limit exceeded'); return { type, data: Buffer.from(bytes).toString('base64') }; }
  private unpack(value: Packed) { return this.serde.loadsTyped(value.type, Buffer.from(value.data, 'base64')); }
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const store = await this.store(), base = this.key(config);
    const id = config.configurable?.checkpoint_id || await store.client.lIndex(`${base}:ids`, -1);
    if (!id) return undefined;
    const raw = await store.client.get(`${base}:${id}`); if (!raw) return undefined;
    const saved = JSON.parse(raw);
    const writes = await store.client.hGetAll(`${base}:${id}:writes`);
    const sorted = Object.values(writes).map(value => JSON.parse(value)).sort((a,b) =>
      a.path === b.path ? a.task === b.task ? a.index-b.index : a.task < b.task ? -1 : 1 : a.path < b.path ? -1 : 1);
    const pendingWrites: Array<[string,string,unknown]> = [];
    for (const row of sorted) pendingWrites.push([row.task, row.channel, await this.unpack(row.value)]);
    return { config: { configurable: { thread_id: config.configurable!.thread_id, checkpoint_ns: '', checkpoint_id: id } },
      checkpoint: await this.unpack(saved.checkpoint), metadata: await this.unpack(saved.metadata), parentConfig: saved.parentConfig, pendingWrites };
  }
  async *list(config: RunnableConfig, options: { limit?: number; before?: RunnableConfig; filter?: Record<string, any> } = {}) {
    const store = await this.store(), base = this.key(config);
    let ids = await store.client.lRange(`${base}:ids`, 0, -1);
    if (options.before?.configurable?.checkpoint_id) ids = ids.slice(0, ids.indexOf(options.before.configurable.checkpoint_id));
    let count = 0;
    for (const id of ids.reverse()) {
      const tuple = await this.getTuple({ configurable: { ...config.configurable, checkpoint_id: id } });
      if (tuple && Object.entries(options.filter || {}).every(([key,value]) => tuple.metadata?.[key as keyof CheckpointMetadata] === value)) {
        yield tuple; if (++count >= (options.limit || 32)) return;
      }
    }
  }
  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, _versions: Checkpoint['channel_versions']): Promise<RunnableConfig> {
    const store = await this.store(), base = this.key(config);
    const packed = JSON.stringify({ checkpoint: await this.pack(checkpoint), metadata: await this.pack(metadata), parentConfig: config.configurable?.checkpoint_id ? { configurable: { thread_id: config.configurable.thread_id, checkpoint_ns: '', checkpoint_id: config.configurable.checkpoint_id } } : undefined });
    await store.client.multi().set(`${base}:${checkpoint.id}`, packed, { EX: store.ttl }).rPush(`${base}:ids`, checkpoint.id)
      .lTrim(`${base}:ids`, -32, -1).expire(`${base}:ids`, store.ttl).exec();
    return { configurable: { thread_id: config.configurable!.thread_id, checkpoint_ns: '', checkpoint_id: checkpoint.id } };
  }
  async putWrites(config: RunnableConfig, writes: Array<[string,unknown]>, taskId: string, taskPath = '') {
    const store = await this.store(), base = this.key(config), id = config.configurable?.checkpoint_id;
    if (!id) throw new Error('Checkpoint ID required for writes');
    for (let index = 0; index < writes.length; index++) {
      const [channel, value] = writes[index];
      await store.client.hSet(`${base}:${id}:writes`, `${taskId}:${index}`, JSON.stringify({ task: taskId, path: taskPath, index, channel, value: await this.pack(value) }));
    }
    await store.client.expire(`${base}:${id}:writes`, store.ttl);
  }
  async deleteThread(threadId: string) {
    const store = await this.store(), base = this.key({ configurable: { thread_id: threadId } });
    const ids = await store.client.lRange(`${base}:ids`, 0, -1);
    await store.client.del([`${base}:ids`, ...ids.flatMap(id => [`${base}:${id}`, `${base}:${id}:writes`])]);
  }
}
