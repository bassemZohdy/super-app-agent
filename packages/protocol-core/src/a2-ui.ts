/**
 * A2-UI (Agent-to-User Interface Protocol)
 * Bi-directional wire streaming protocol definitions, envelopes, and validators.
 */

import { validateAGUISurface, type AGUISurfacePayload, type ValidationResult } from './ag-ui.ts';

export const SUPPORTED_MESSAGE_TYPES = [
  'A2UI_HANDSHAKE',
  'A2UI_HANDSHAKE_ACK',
  'A2UI_USER_INTENT',
  'A2UI_STREAM_DELTA',
  'A2UI_RENDER_SURFACE',
  'A2UI_EVENT_TRIGGER',
  'A2UI_LAUNCH_MINIAPP',
  'A2UI_CLIENT_ERROR',
] as const;

export type A2UIMessageType = (typeof SUPPORTED_MESSAGE_TYPES)[number];

export interface A2UIHandshakePayload {
  platform: 'react' | 'angular' | 'flutter' | 'web_responsive';
  viewport: {
    width: number;
    height: number;
    category: 'mobile' | 'tablet' | 'desktop';
  };
  supportedComponents: string[];
  locale?: string;
}

export interface A2UIHandshakeAckPayload {
  status: 'connected';
  supportedProtocols: string[];
  sessionId: string;
}

export interface A2UIUserIntentPayload {
  sessionId: string;
  text: string;
  handshake?: A2UIHandshakePayload;
}

export interface A2UIStreamDeltaPayload {
  phase: 'REASONING' | 'TOOL_EXECUTION' | 'FINALIZING';
  text: string;
  activeTool?: string;
}

export interface A2UIRenderSurfacePayload {
  mode: 'REPLACE' | 'PATCH' | 'APPEND';
  surface: AGUISurfacePayload;
}

export interface A2UIEventTriggerPayload {
  originComponentId: string;
  action: string;
  payload: Record<string, any>;
}

export interface A2UILaunchMiniAppPayload {
  miniAppId: string;
  entryRoute?: string;
  params?: Record<string, any>;
}

export interface A2UIClientErrorPayload {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface A2UIMessageEnvelope<T = any> {
  id: string;
  type: A2UIMessageType;
  sessionId: string;
  timestamp: number;
  data: T;
}

/**
 * Create a strongly-typed A2-UI envelope
 */
export function createA2UIMessage<T>(
  type: A2UIMessageType,
  sessionId: string,
  data: T
): A2UIMessageEnvelope<T> {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    type,
    sessionId,
    timestamp: Date.now(),
    data,
  };
}

/**
 * Validate an incoming A2-UI envelope
 */
export function validateA2UIMessage(envelope: unknown): ValidationResult<A2UIMessageEnvelope> {
  const errors: string[] = [];

  if (!envelope || typeof envelope !== 'object') {
    return { success: false, errors: ['Envelope must be an object'] };
  }

  const env = envelope as Record<string, any>;

  if (typeof env.id !== 'string' || !env.id.trim()) {
    errors.push("Missing or invalid 'id' string");
  }

  if (!SUPPORTED_MESSAGE_TYPES.includes(env.type)) {
    errors.push(
      `Invalid message type '${env.type}'. Expected one of: ${SUPPORTED_MESSAGE_TYPES.join(', ')}`
    );
  }

  if (typeof env.sessionId !== 'string' || !env.sessionId.trim()) {
    errors.push("Missing or invalid 'sessionId'");
  }

  if (typeof env.timestamp !== 'number') {
    errors.push("Missing or invalid 'timestamp' number");
  }

  if (env.data === undefined) {
    errors.push("Missing 'data' payload");
  } else if (env.type === 'A2UI_RENDER_SURFACE') {
    const surface = env.data.surface;
    const surfaceValidation = validateAGUISurface(surface);
    if (!surfaceValidation.success && surfaceValidation.errors) {
      errors.push(...surfaceValidation.errors);
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: env as A2UIMessageEnvelope };
}
