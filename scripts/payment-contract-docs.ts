type Versions = { payment: string; provider: string };
type Kind = keyof Versions;

// Current guides with explicit payment version claims. Historical reports retain their original versions.
const both = [
  'docs/architecture/service-contracts.md', 'docs/development/checkout-groups.md',
  'docs/development/issuer-scenarios.md', 'docs/development/payment-events.md',
  'docs/development/payment-history.md', 'docs/development/payment-lifecycle.md',
  'docs/development/payment-mandates.md', 'docs/development/payment-obligations.md',
  'docs/development/payment-reconciliation.md', 'docs/development/payment-refunds.md',
  'docs/development/provider-recharges.md',
];
const tracked: Record<string, readonly Kind[]> = Object.fromEntries(both.map(file => [file, ['payment', 'provider']]));
tracked['docs/development/payment-accounts.md'] = ['provider'];
tracked['docs/demo/provider-backends.md'] = ['provider'];

const patterns: Record<Kind, RegExp> = {
  payment: /\bpayment contract(?:\s+is)?\s+(?:\*\*)?(\d+\.\d+\.\d+)\b/gi,
  provider: /\b(?:payment-provider|payments|provider) OpenAPI(?:\s+is)?\s+(?:\*\*)?(\d+\.\d+\.\d+)\b|\band\s+(\d+\.\d+\.\d+)\s+for payment setup\b/gi,
};

export function checkPaymentContractVersions(file: string, source: string, versions: Versions): string[] {
  const kinds = tracked[file.replaceAll('\\', '/')];
  if (!kinds) return [];
  const errors: string[] = [];
  for (const kind of kinds) {
    const matches = [...source.matchAll(patterns[kind])];
    if (!matches.length) errors.push(`${file}: missing ${kind} version claim`);
    for (const match of matches) {
      const version = match[1] ?? match[2];
      if (version !== versions[kind]) errors.push(`${file}: ${kind} version ${version} differs from current ${versions[kind]}`);
    }
  }
  return errors;
}
