/**
 * A2-UI (Agent-to-User Interface Protocol)
 * Bi-directional wire streaming protocol definitions, envelopes, and validators.
 */

import { validateAGUISurface, type AGUISurfacePayload, type ValidationResult } from './ag-ui.ts';
import { describeInput } from './describe-input.ts';

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

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { success: false, errors: ['Envelope must be an object'] };
  }

  const env = envelope as Record<string, any>;

  if (typeof env.id !== 'string' || !env.id.trim() || env.id.length > 128) {
    errors.push("Missing or invalid 'id' string");
  }

  if (!SUPPORTED_MESSAGE_TYPES.includes(env.type)) {
    errors.push(
      `Invalid message type '${describeInput(env.type)}'. Expected one of: ${SUPPORTED_MESSAGE_TYPES.join(', ')}`
    );
  }

  if (typeof env.sessionId !== 'string' || !env.sessionId.trim() || env.sessionId.length > 128) {
    errors.push("Missing or invalid 'sessionId'");
  }

  if (typeof env.timestamp !== 'number' || !Number.isFinite(env.timestamp) || env.timestamp < 0) {
    errors.push("Missing or invalid 'timestamp' number");
  }

  if (!env.data || typeof env.data !== 'object' || Array.isArray(env.data)) {
    errors.push("Missing or invalid 'data' object");
  } else if (env.type === 'A2UI_RENDER_SURFACE') {
    if (!['REPLACE', 'PATCH', 'APPEND'].includes(env.data.mode)) {
      errors.push('Invalid render mode');
    }
    const surface = env.data.surface;
    const surfaceValidation = validateAGUISurface(surface);
    if (!surfaceValidation.success && surfaceValidation.errors) {
      errors.push(...surfaceValidation.errors);
    } else if (surface.sessionId !== env.sessionId) {
      errors.push('Surface sessionId must match envelope sessionId');
    }
  }

  if (env.data && typeof env.data === 'object' && !Array.isArray(env.data)) {
    const d = env.data;
    const bounded = (value: unknown, limit = 4000) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
    if (env.type === 'A2UI_STREAM_DELTA' && (!['REASONING','TOOL_EXECUTION','FINALIZING'].includes(d.phase) || !bounded(d.text) || (d.activeTool !== undefined && !bounded(d.activeTool,128)))) errors.push('Invalid stream delta');
    if (env.type === 'A2UI_USER_INTENT' && (d.sessionId !== env.sessionId || !bounded(d.text))) errors.push('Invalid user intent');
    if (env.type === 'A2UI_HANDSHAKE_ACK' && (d.status !== 'connected' || d.sessionId !== env.sessionId || !Array.isArray(d.supportedProtocols) || !d.supportedProtocols.length || d.supportedProtocols.length > 10 || d.supportedProtocols.some((p: unknown) => !bounded(p,64)))) errors.push('Invalid handshake acknowledgement');
    if (env.type === 'A2UI_HANDSHAKE' && (!['react','angular','flutter','web_responsive'].includes(d.platform) || !d.viewport || !Number.isInteger(d.viewport.width) || d.viewport.width < 1 || d.viewport.width > 20000 || !Number.isInteger(d.viewport.height) || d.viewport.height < 1 || d.viewport.height > 20000 || !['mobile','tablet','desktop'].includes(d.viewport.category) || !Array.isArray(d.supportedComponents) || !d.supportedComponents.length || d.supportedComponents.length > 100 || d.supportedComponents.some((p: unknown) => !bounded(p,64)))) errors.push('Invalid handshake');
    if (env.type === 'A2UI_EVENT_TRIGGER' && (!bounded(d.originComponentId,128) || !bounded(d.action,128) || !d.payload || typeof d.payload !== 'object' || Array.isArray(d.payload))) errors.push('Invalid action event');
    if (env.type === 'A2UI_LAUNCH_MINIAPP' && (!bounded(d.miniAppId,128) || (d.entryRoute !== undefined && (!bounded(d.entryRoute,256) || !/^\/(?!\/)/.test(d.entryRoute))))) errors.push('Invalid mini-app launch');
    if (env.type === 'A2UI_CLIENT_ERROR' && (!bounded(d.code,128) || !bounded(d.message))) errors.push('Invalid client error');
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: env as A2UIMessageEnvelope };
}
