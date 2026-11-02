import { AsyncLocalStorage } from 'node:async_hooks';

// The gateway owns these callbacks and runs them only after saving the completed session.
const storage = new AsyncLocalStorage<Array<() => Promise<void>>>();
export function withCivicFinalizers<T>(finalizers: Array<() => Promise<void>>, run: () => Promise<T>): Promise<T> {
  return storage.run(finalizers, run);
}
export function deferCivicRelease(release: () => Promise<void>): boolean {
  const finalizers = storage.getStore();
  if (!finalizers) return false;
  finalizers.push(release);
  return true;
}
