import type { AGUISurfacePayload } from '../../../../packages/protocol-core/src/index.ts';

export type DomainCategory = 'concierge' | 'ride' | 'food' | 'wallet' | 'telecom' | 'composite';

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
}

export interface SuperAppAgentState {
  sessionId: string;
  messages: AgentMessage[];
  activeDomain: DomainCategory;
  currentSurface?: AGUISurfacePayload;
  paymentFlow?: import('../payment-surfaces.ts').SurfacePaymentFlow;
  approval?: import('../approvals.ts').SurfaceApproval;
  approvalHistory?: Array<{ id: string; revision: string; at: number; event: 'offered' | 'confirmed' | 'cancelled'; action?: string }>;
  conversationTopic?: string;
  pendingAction?: {
    action: string;
    payload: Record<string, any>;
  };
  reconciliation?: { outcome: 'UNKNOWN' | 'PARTIALLY_COMPLETED'; steps: import('../domain-operations.ts').Step[] };
  threadCheckpointId?: string;
  metadata?: Record<string, any>;
}

