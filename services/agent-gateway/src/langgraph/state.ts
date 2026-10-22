import { AGUISurfacePayload } from '@superapp/protocol-core';

export type DomainCategory = 'concierge' | 'ride' | 'food' | 'wallet' | 'composite';

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
  pendingAction?: {
    action: string;
    payload: Record<string, any>;
  };
  threadCheckpointId?: string;
}
