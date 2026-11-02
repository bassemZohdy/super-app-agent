/** Clean the dedicated qualification resources and retain both errors if cleanup also fails. */
export async function withQualificationCleanup<T>(run: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
  let failed = false, failure: unknown, result: T | undefined;
  try { result = await run(); }
  catch (error) { failed = true; failure = error; }
  try { await cleanup(); }
  catch (error) {
    if (failed) throw new AggregateError([failure, error], 'Qualification and cleanup both failed.');
    throw error;
  }
  if (failed) throw failure;
  return result as T;
}
