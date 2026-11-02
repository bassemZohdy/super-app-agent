/** Try every cleanup step, then report all failures without skipping later resources. */
export async function cleanupAll(steps: Array<() => void | Promise<void>>): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try { await step(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Isolated environment cleanup failed.');
}

/** Preserve startup failure when the cleanup of partially created resources also fails. */
export async function rethrowWithCleanup(error: unknown, cleanup: () => Promise<void>): Promise<never> {
  try { await cleanup(); }
  catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Isolated environment startup and cleanup failed.'); }
  throw error;
}

/** Apply isolated settings and restore their prior presence and values once cleanup finishes. */
export function temporaryEnvironment(env: NodeJS.ProcessEnv, settings: Record<string, string>): () => void {
  const previous = Object.entries(settings).map(([key]) => [key, env[key]] as const);
  Object.assign(env, settings);
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const [key, value] of previous) { if (value === undefined) delete env[key]; else env[key] = value; }
  };
}
