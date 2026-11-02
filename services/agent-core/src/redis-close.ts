type RedisConnection = { readonly isOpen: boolean; readonly isReady: boolean; quit(): Promise<unknown>; destroy(): void };

/** Close independent connections concurrently; disconnect a stalled or already-offline client. */
export async function closeRedisConnections(connections: Array<RedisConnection | undefined>, timeoutMs = 2000): Promise<void> {
  const results = await Promise.allSettled(connections.map(async connection => {
    if (!connection?.isOpen) return;
    if (!connection.isReady) { connection.destroy(); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        connection.quit(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Redis close timed out.')), timeoutMs); }),
      ]);
    } catch {
      try { if (connection.isOpen) connection.destroy(); } catch { /* Report a generic close failure below. */ }
      throw new Error('A Redis connection could not close cleanly.');
    } finally { clearTimeout(timer); }
  }));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(() => new Error('A Redis connection could not close cleanly.'));
  if (failures.length) throw new AggregateError(failures, 'Redis connections could not all close cleanly.');
}
