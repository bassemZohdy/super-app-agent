import { z } from 'zod';
import { AGUISurfaceSchema, AGUISurfacePayload } from './ag-ui.js';

export const A2UIMessageTypeSchema = z.enum([
  'A2UI_HANDSHAKE',
  'A2UI_HANDSHAKE_ACK',
  'A2UI_USER_INTENT',
  'A2UI_STREAM_DELTA',
  'A2UI_RENDER_SURFACE',
  'A2UI_EVENT_TRIGGER',
  'A2UI_LAUNCH_MINIAPP',
  'A2UI_CLIENT_ERROR',
]);

export type A2UIMessageType = z.infer<typeof A2UIMessageTypeSchema>;

export const A2UIHandshakePayloadSchema = z.object({
  platform: z.enum(['react', 'angular', 'flutter', 'web_responsive']),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
    category: z.enum(['mobile', 'tablet', 'desktop']),
  }),
  supportedComponents: z.array(z.string()),
  locale: z.string().default('en-US'),
});

export type A2UIHandshakePayload = z.infer<typeof A2UIHandshakePayloadSchema>;

export const A2UIStreamDeltaPayloadSchema = z.object({
  phase: z.enum(['REASONING', 'TOOL_EXECUTION', 'FINALIZING']),
  text: z.string(),
  activeTool: z.string().optional(),
});

export type A2UIStreamDeltaPayload = z.infer<typeof A2UIStreamDeltaPayloadSchema>;

export const A2UIRenderSurfacePayloadSchema = z.object({
  mode: z.enum(['REPLACE', 'PATCH', 'APPEND']),
  surface: AGUISurfaceSchema,
});

export type A2UIRenderSurfacePayload = z.infer<typeof A2UIRenderSurfacePayloadSchema>;

export const A2UIEventTriggerPayloadSchema = z.object({
  originComponentId: z.string(),
  action: z.string(),
  payload: z.record(z.any()),
});

export type A2UIEventTriggerPayload = z.infer<typeof A2UIEventTriggerPayloadSchema>;

export const A2UIMessageEnvelopeSchema = z.object({
  id: z.string(),
  type: A2UIMessageTypeSchema,
  sessionId: z.string(),
  timestamp: z.number(),
  data: z.any(),
});

export type A2UIMessageEnvelope<T = any> = {
  id: string;
  type: A2UIMessageType;
  sessionId: string;
  timestamp: number;
  data: T;
};

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
