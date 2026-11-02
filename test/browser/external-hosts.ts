/** Which requests a browser journey may make (QA-09): only to this machine. Non-network schemes (data:, blob:, about:) are
 *  not requests to a host. Kept free of the Playwright runtime so the rule can be unit tested. */
import { PORTS } from '../../scripts/qualification-stack.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const INTERACTIVE_PORTS = new Set(Object.values(PORTS));

export const isLocalRequest = (url: URL) => !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || LOCAL_HOSTS.has(url.hostname);
export const isInteractiveStackRequest = (url: URL, offset: number) => offset !== 0 &&
  ['http:', 'https:'].includes(url.protocol) && LOCAL_HOSTS.has(url.hostname) && INTERACTIVE_PORTS.has(Number(url.port));
