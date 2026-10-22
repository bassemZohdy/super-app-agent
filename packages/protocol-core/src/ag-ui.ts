import { z } from 'zod';

export const ComponentTypeSchema = z.enum([
  'SurfaceCard',
  'Heading',
  'Text',
  'Badge',
  'ChoiceGroup',
  'Button',
  'FormInput',
  'MetricWidget',
  'MapViewer',
  'DataTable',
  'MiniAppEmbed',
]);

export type ComponentType = z.infer<typeof ComponentTypeSchema>;

export const ActionBindingSchema = z.object({
  event: z.enum(['onPress', 'onChange', 'onSubmit']),
  actionType: z.enum(['AGENT_ACTION_DISPATCH', 'LAUNCH_MINIAPP', 'HOST_NAVIGATE']),
  payload: z.record(z.any()),
});

export type ActionBinding = z.infer<typeof ActionBindingSchema>;

export const UIStyleSchema = z.object({
  variant: z.enum(['primary', 'secondary', 'outline', 'ghost', 'danger', 'success']).optional(),
  padding: z.enum(['none', 'small', 'medium', 'large']).optional(),
  direction: z.enum(['horizontal', 'vertical']).optional(),
  spacing: z.enum(['none', 'small', 'medium', 'large']).optional(),
  fullWidth: z.boolean().optional(),
  align: z.enum(['start', 'center', 'end', 'between']).optional(),
});

export type UIStyle = z.infer<typeof UIStyleSchema>;

export type UIComponentNode = {
  type: ComponentType;
  id: string;
  properties?: Record<string, any>;
  style?: UIStyle;
  children?: UIComponentNode[];
  onEvents?: ActionBinding[];
};

export const UIComponentNodeSchema: z.ZodType<UIComponentNode> = z.lazy(() =>
  z.object({
    type: ComponentTypeSchema,
    id: z.string(),
    properties: z.record(z.any()).optional(),
    style: UIStyleSchema.optional(),
    children: z.array(UIComponentNodeSchema).optional(),
    onEvents: z.array(ActionBindingSchema).optional(),
  })
);

export const AGUISurfaceSchema = z.object({
  version: z.literal('1.0.0'),
  sessionId: z.string(),
  timestamp: z.string().or(z.number()),
  view: UIComponentNodeSchema,
});

export type AGUISurfacePayload = z.infer<typeof AGUISurfaceSchema>;

export function validateAGUISurface(data: unknown): { success: true; data: AGUISurfacePayload } | { success: false; error: z.ZodError } {
  const result = AGUISurfaceSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
