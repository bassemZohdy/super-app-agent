/** Do not describe an unconfirmed pause as a failed or unchanged rule. */
export function pauseAllMessage(value: unknown): string {
  const next = 'They may already be paused. Check their current state before trying again. Pausing stops new runs only; a payment already made is not reversed.';
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `Pause results could not be confirmed. ${next}`;
  const response = value as Record<string, unknown>;
  if (response.success !== true || Object.prototype.hasOwnProperty.call(response, 'error') || !Array.isArray(response.paused) || !Array.isArray(response.notPaused) ||
      !response.paused.every(id => typeof id === 'string' && id.length > 0) ||
      !response.notPaused.every(entry => entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.mandateId === 'string' && entry.mandateId.length > 0 && typeof entry.code === 'string' && entry.code.length > 0))
    return `Pause results could not be confirmed. ${next}`;
  const ids = [...response.paused, ...response.notPaused.map(entry => entry.mandateId)];
  if (new Set(ids).size !== ids.length) return `Pause results could not be confirmed. ${next}`;
  const paused = response.paused.length, uncertain = response.notPaused.length;
  return `Paused ${paused} rule${paused === 1 ? '' : 's'}.${uncertain ? ` ${uncertain} rule${uncertain === 1 ? '' : 's'} could not be confirmed. ${next}` : ' Pausing stops new runs only; a payment already made is not reversed.'}`;
}
