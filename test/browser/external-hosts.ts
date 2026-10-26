/** Which requests a browser journey may make (QA-09): only to this machine. Non-network schemes (data:, blob:, about:) are
 *  not requests to a host. Kept free of the Playwright runtime so the rule can be unit tested. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const isLocalRequest = (url: URL) => !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || LOCAL_HOSTS.has(url.hostname);
