import definitions from './capabilities.json' with { type: 'json' };

export interface Capability {
  id: string;
  name: string;
  version: string;
  owner: string;
  description: string;
  availability: 'simulation-only';
  inputSchema: Record<string, unknown>;
  /** Success and error response data; nested domain objects remain extensible in v1. */
  outputSchema: Record<string, unknown>;
  risk: { level: 'public' | 'personal-data' | 'financial' | 'high-impact'; mutates: boolean; requiresConfirmation: boolean };
  consent: { required: boolean; scopes: string[]; subjectBound: boolean; delegationAllowed: boolean };
  execution: { transport: 'http'; method: 'GET' | 'POST'; path: string; inputLocation: 'query' | 'body' | 'path' };
  exampleInput: Record<string, unknown>;
}

// Metadata is a contract for future adapters, not permission to execute a tool.
export const capabilities = definitions as Capability[];
