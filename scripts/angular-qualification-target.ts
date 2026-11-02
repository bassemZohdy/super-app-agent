/** Refuse a qualification run before opening a browser if Angular was built for a different gateway. */
export function assertAngularQualificationTarget(bundle: string, gateway: string, offset: number): void {
  if (offset === 0) return;
  const configured = [...bundle.matchAll(/\bgatewayUrl\s*:\s*(["'])([^"']+)\1/g)].map(match => match[2]);
  const expected = `http://localhost:${4000 + offset}`;
  if (gateway !== expected || configured.length !== 1 || configured[0] !== expected) {
    throw new Error(`Angular qualification build must target ${expected}. Set SHELL_GATEWAY_URL and rebuild before the browser run.`);
  }
}
