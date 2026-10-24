import { createHash } from 'node:crypto';
import { operations, providerIds, type ProviderId } from '../../provider-simulator/src/contracts.ts';
import { accountIdFor } from '../../../packages/backend-kit/src/context.ts';

export const brokerClient = 'delegation-broker';
export const runnerClient = 'delegation-runner';
export const idpAlias = 'trusted-delegation-issuer';
export class DelegationError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function deny(code = 'DELEGATION_DENIED', message = 'Delegated authority is missing, expired or does not permit this operation.'): never { throw new DelegationError(403, code, message); }
export const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export type Operation = { provider: ProviderId; method: 'GET' | 'POST'; path: string; body: Record<string, unknown> };
export type GrantInput = Operation & { accountId: string; purpose: string; expiresInSeconds: number; maxOperations: number };
export function grantInput(owner: string, input: GrantInput): GrantInput {
  if (!input || !['personal', 'household'].some(slot => accountIdFor(owner, slot) === input.accountId)) deny('ACCOUNT_FORBIDDEN');
  if (!providerIds.includes(input.provider) || !['GET', 'POST'].includes(input.method) || typeof input.path !== 'string' || !/^\/[a-zA-Z0-9/_-]{1,200}$/.test(input.path) || input.path.includes('//')) deny('INVALID_OPERATION');
  const route = operations[input.provider].find(op => op.method === input.method && new RegExp(`^${op.path.replace(/\{\w+\}/g, '[a-zA-Z0-9_-]+')}$`).test(input.path));
  if (!route || typeof input.purpose !== 'string' || input.purpose.trim().length < 5 || input.purpose.length > 200 || !Number.isInteger(input.expiresInSeconds) || input.expiresInSeconds < 60 || input.expiresInSeconds > 3600 || !Number.isInteger(input.maxOperations) || input.maxOperations < 1 || input.maxOperations > 10) deny('INVALID_GRANT');
  // First write slice: synthetic wallet credit only, exact amount and source.
  const body = input.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) deny('INVALID_OPERATION');
  if (input.method === 'POST') {
    if (input.provider !== 'payments' || input.path !== '/topups' || Object.keys(body).sort().join(',') !== 'amountMinor,source' || !Number.isSafeInteger(body.amountMinor) || Number(body.amountMinor) < 100 || Number(body.amountMinor) > 1000 || body.source !== 'demo_approved' || input.maxOperations !== 1) deny('WRITE_NOT_APPROVED', 'Only one explicitly approved synthetic wallet credit of AED 1–10 is supported.');
  } else if (Object.keys(body).length) deny('INVALID_OPERATION');
  return { provider: input.provider, method: input.method, path: input.path, body, accountId: input.accountId, purpose: input.purpose.trim(), expiresInSeconds: input.expiresInSeconds, maxOperations: input.maxOperations };
}
