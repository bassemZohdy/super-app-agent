import { boundedJsonResponse } from '../../packages/backend-kit/src/bounded-json.ts';

/** Read a bounded token without including identity-server content in errors. */
export async function readAutomationToken(response: Response): Promise<string> {
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => {});
    throw new Error(`Automation token request failed (HTTP ${response.status}).`);
  }
  try {
    const body = await boundedJsonResponse(response, 65536);
    const token = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).access_token : undefined;
    if (typeof token !== 'string' || !/^[\x21-\x7e]{1,16384}$/.test(token)) throw new Error('Invalid token');
    return token;
  } catch {
    throw new Error('Automation token response was invalid.');
  }
}
