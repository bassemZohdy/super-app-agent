/**
 * AG-UI (Agent-Generated UI / Adaptive Generative UI)
 * Declarative component tree specification and validation engine.
 */

export const SUPPORTED_COMPONENT_TYPES = [
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
] as const;

export type ComponentType = (typeof SUPPORTED_COMPONENT_TYPES)[number];

export type ActionEventName = 'onPress' | 'onChange' | 'onSubmit';
export type ActionType = 'AGENT_ACTION_DISPATCH' | 'LAUNCH_MINIAPP' | 'HOST_NAVIGATE';

export interface ActionBinding {
  event: ActionEventName;
  actionType: ActionType;
  payload: Record<string, any>;
}

export interface UIStyle {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
  padding?: 'none' | 'small' | 'medium' | 'large';
  direction?: 'horizontal' | 'vertical';
  spacing?: 'none' | 'small' | 'medium' | 'large';
  fullWidth?: boolean;
  align?: 'start' | 'center' | 'end' | 'between';
}

export interface HeadingProperties {
  text: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface TextProperties {
  text: string;
  muted?: boolean;
  size?: 'sm' | 'base' | 'lg';
}

export interface BadgeProperties {
  text: string;
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
}

export interface ButtonProperties {
  label: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: string;
}

export interface ChoiceOption {
  id: string;
  title: string;
  subtitle?: string;
  price?: string;
  badge?: string;
  icon?: string;
  metadata?: Record<string, any>;
}

export interface ChoiceGroupProperties {
  name?: string;
  selectedId?: string;
  options: ChoiceOption[];
}

export interface FormInputProperties {
  name: string;
  label?: string;
  placeholder?: string;
  inputType?: 'text' | 'number' | 'email' | 'tel';
  defaultValue?: string;
}

export interface MetricWidgetProperties {
  label: string;
  value: string | number;
  subtext?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export interface MapCoordinate {
  lat: number;
  lng: number;
}

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  icon?: string;
}

export interface MapViewerProperties {
  center?: MapCoordinate;
  zoom?: number;
  markers?: MapMarker[];
  routePolyline?: MapCoordinate[];
  interactive?: boolean;
}

export interface DataTableColumn {
  key: string;
  title: string;
}

export interface DataTableProperties {
  columns: DataTableColumn[];
  rows: Record<string, any>[];
}

export interface MiniAppEmbedProperties {
  miniAppId: string;
  entryRoute?: string;
  params?: Record<string, any>;
  height?: string;
}

export interface UIComponentNode {
  type: ComponentType;
  id: string;
  properties?: Record<string, any>;
  style?: UIStyle;
  children?: UIComponentNode[];
  onEvents?: ActionBinding[];
}

export interface AGUISurfacePayload {
  version: '1.0.0';
  sessionId: string;
  timestamp: number | string;
  view: UIComponentNode;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

/**
 * Validate a UIComponentNode recursively
 */
export function validateUIComponentNode(node: unknown, path = 'root'): ValidationResult<UIComponentNode> {
  const errors: string[] = [];

  if (!node || typeof node !== 'object') {
    return { success: false, errors: [`${path}: Node must be an object`] };
  }

  const n = node as Record<string, any>;

  if (typeof n.id !== 'string' || !n.id.trim()) {
    errors.push(`${path}: Missing or invalid 'id' string`);
  }

  if (!SUPPORTED_COMPONENT_TYPES.includes(n.type)) {
    errors.push(
      `${path}: Invalid component type '${n.type}'. Expected one of: ${SUPPORTED_COMPONENT_TYPES.join(', ')}`
    );
  }

  if (n.children !== undefined) {
    if (!Array.isArray(n.children)) {
      errors.push(`${path}.children: Must be an array of component nodes`);
    } else {
      n.children.forEach((child, index) => {
        const childRes = validateUIComponentNode(child, `${path}.children[${index}]`);
        if (!childRes.success && childRes.errors) {
          errors.push(...childRes.errors);
        }
      });
    }
  }

  if (n.onEvents !== undefined) {
    if (!Array.isArray(n.onEvents)) {
      errors.push(`${path}.onEvents: Must be an array of action bindings`);
    } else {
      n.onEvents.forEach((evt, idx) => {
        if (!evt || typeof evt !== 'object') {
          errors.push(`${path}.onEvents[${idx}]: Must be an object`);
          return;
        }
        if (!['onPress', 'onChange', 'onSubmit'].includes(evt.event)) {
          errors.push(`${path}.onEvents[${idx}]: Invalid event '${evt.event}'`);
        }
        if (!['AGENT_ACTION_DISPATCH', 'LAUNCH_MINIAPP', 'HOST_NAVIGATE'].includes(evt.actionType)) {
          errors.push(`${path}.onEvents[${idx}]: Invalid actionType '${evt.actionType}'`);
        }
      });
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: n as UIComponentNode };
}

/**
 * Validate a top-level AG-UI Surface payload
 */
export function validateAGUISurface(data: unknown): ValidationResult<AGUISurfacePayload> {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { success: false, errors: ['Payload must be an object'] };
  }

  const payload = data as Record<string, any>;

  if (payload.version !== '1.0.0') {
    errors.push(`Invalid version '${payload.version}'. Expected '1.0.0'`);
  }

  if (typeof payload.sessionId !== 'string' || !payload.sessionId.trim()) {
    errors.push("Missing or invalid 'sessionId'");
  }

  if (payload.timestamp === undefined || (typeof payload.timestamp !== 'number' && typeof payload.timestamp !== 'string')) {
    errors.push("Missing or invalid 'timestamp' (number or string)");
  }

  const viewValidation = validateUIComponentNode(payload.view, 'view');
  if (!viewValidation.success && viewValidation.errors) {
    errors.push(...viewValidation.errors);
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: payload as AGUISurfacePayload };
}

/**
 * Helper builder: SurfaceCard
 */
export function createSurfaceCard(
  id: string,
  children: UIComponentNode[],
  style?: UIStyle
): UIComponentNode {
  return {
    type: 'SurfaceCard',
    id,
    style: style || { padding: 'medium', direction: 'vertical' },
    children,
  };
}

/**
 * Helper builder: Heading
 */
export function createHeading(id: string, text: string, level: 1 | 2 | 3 | 4 | 5 | 6 = 2): UIComponentNode {
  return {
    type: 'Heading',
    id,
    properties: { text, level },
  };
}

/**
 * Helper builder: Text
 */
export function createText(id: string, text: string, muted = false): UIComponentNode {
  return {
    type: 'Text',
    id,
    properties: { text, muted },
  };
}

/**
 * Helper builder: Button
 */
export function createButton(
  id: string,
  label: string,
  actionPayload: Record<string, any>,
  actionType: ActionType = 'AGENT_ACTION_DISPATCH',
  variant: UIStyle['variant'] = 'primary'
): UIComponentNode {
  return {
    type: 'Button',
    id,
    properties: { label, variant, fullWidth: true },
    onEvents: [
      {
        event: 'onPress',
        actionType,
        payload: actionPayload,
      },
    ],
  };
}
