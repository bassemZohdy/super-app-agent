import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function keyMaterial(kind: 'issuer' | 'client') {
  const dir = process.env.DELEGATION_KEY_DIR || '.data/delegation/keys';
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${kind}.pem`);
  if (!existsSync(path)) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
    try { writeFileSync(path, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const key = createPrivateKey(readFileSync(path));
  const publicKey = createPublicKey(key).export({ format: 'jwk' });
  const kid = `${kind}-${publicKey.n!.slice(-24)}`;
  return { key, jwk: { ...publicKey, kid, use: 'sig', alg: 'RS256' }, kid };
}
export function signedJwt(kind: 'issuer' | 'client', payload: Record<string, unknown>) {
  const { key, kid } = keyMaterial(kind);
  const body = [Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url'), Buffer.from(JSON.stringify(payload)).toString('base64url')].join('.');
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}
export const assertionTimes = (expiresAt: number) => { const iat = Math.floor(Date.now() / 1000); return { iat, nbf: iat, exp: Math.min(iat + 90, Math.floor(expiresAt / 1000)), jti: randomUUID() }; };
