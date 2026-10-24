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
  payload: Record<string, unknown>;
}

export interface UIStyle {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'warning' | 'success';
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
  metadata?: Record<string, unknown>;
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
  rows: Record<string, unknown>[];
}

export interface MiniAppEmbedProperties {
  miniAppId: string;
  entryRoute?: string;
  params?: Record<string, unknown>;
  height?: string;
}

/**
 * Flat view of every property a component may carry. Each field is optional
 * because the set of fields depends on `UIComponentNode.type`; consumers must
 * check the field they read.
 */
export interface UIComponentProperties {
  text?: string;
  level?: HeadingProperties['level'];
  muted?: boolean;
  size?: TextProperties['size'];
  variant?: ButtonProperties['variant'] | BadgeProperties['variant'];
  label?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: string;
  name?: string;
  selectedId?: string;
  options?: ChoiceOption[];
  placeholder?: string;
  inputType?: FormInputProperties['inputType'];
  defaultValue?: string;
  value?: MetricWidgetProperties['value'];
  subtext?: string;
  trend?: MetricWidgetProperties['trend'];
  center?: MapCoordinate;
  zoom?: number;
  markers?: MapMarker[];
  routePolyline?: MapCoordinate[];
  interactive?: boolean;
  columns?: DataTableColumn[];
  rows?: Record<string, unknown>[];
  miniAppId?: string;
  entryRoute?: string;
  params?: Record<string, unknown>;
  height?: string;
}

export interface UIComponentNode {
  type: ComponentType;
  id: string;
  properties?: UIComponentProperties;
  style?: UIStyle;
  children?: UIComponentNode[];
  onEvents?: ActionBinding[];
}

export interface AGUISurfacePayload {
  version: '1.0.0';
  /** Opaque revision issued by core; action requests must echo it. */
  revision?: string;
  assistantMessage?: { id: string; text: string };
  sessionId: string;
  timestamp: number | string;
  view: UIComponentNode;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

const EVENT_NAMES: readonly unknown[] = ['onPress', 'onChange', 'onSubmit'];
const ACTION_TYPES: readonly unknown[] = ['AGENT_ACTION_DISPATCH', 'LAUNCH_MINIAPP', 'HOST_NAVIGATE'];

/** True for non-null objects, including arrays (matches the `!x || typeof x !== 'object'` checks). */
function isObjectLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

/** True for non-null, non-array objects. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isObjectLike(value) && !Array.isArray(value);
}

/**
 * Validate a UIComponentNode recursively
 */
export function validateUIComponentNode(
  node: unknown, path = 'root', depth = 0, budget = { nodes: 0, ids: new Set<string>() },
): ValidationResult<UIComponentNode> {
  const errors: string[] = [];
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return { success: false, errors: [`${path}: Node must be an object`] };
  }
  if (depth > 20) return { success: false, errors: [`${path}: Maximum UI depth exceeded`] };
  if (++budget.nodes > 500) return { success: false, errors: [`${path}: Maximum total UI nodes exceeded`] };
  if (depth === 0) {
    try { if (new TextEncoder().encode(JSON.stringify(node)).byteLength > 262144) return { success: false, errors: ['UI byte budget exceeded'] }; }
    catch { return { success: false, errors: ['UI must be serializable JSON'] }; }
  }
  const n = node as Record<string, unknown>;
  if (typeof n.id === 'string') {
    if (budget.ids.has(n.id)) errors.push(`${path}: Duplicate component ID`);
    budget.ids.add(n.id);
  }
  if (typeof n.id !== 'string' || !n.id.trim() || n.id.length > 128) {
    errors.push(`${path}: Missing or invalid 'id' string`);
  }
  if (!SUPPORTED_COMPONENT_TYPES.some((type) => type === n.type)) {
    errors.push(`${path}: Invalid component type '${n.type}'. Expected one of: ${SUPPORTED_COMPONENT_TYPES.join(', ')}`);
  }
  if (n.properties !== undefined && !isPlainRecord(n.properties)) {
    errors.push(`${path}.properties: Must be an object`);
  }
  const props: Record<string, unknown> = isObjectLike(n.properties) ? n.properties : {};
  if (n.type === 'Heading' || n.type === 'Text' || n.type === 'Badge') {
    if (typeof props.text !== 'string' || props.text.length > 4000) {
      errors.push(`${path}.properties.text: Must be a string (max 4000 chars)`);
    }
  }
  if (n.type === 'Button' && (typeof props.label !== 'string' || !props.label.trim())) {
    errors.push(`${path}.properties.label: Button requires label`);
  }
  if (n.type === 'FormInput' && (typeof props.name !== 'string' || !props.name.trim())) {
    errors.push(`${path}.properties.name: FormInput requires name`);
  }
  if (n.type === 'ChoiceGroup') {
    if (!Array.isArray(props.options) || props.options.length > 100 ||
        props.options.some((o: unknown) => !isObjectLike(o) || typeof o.id !== 'string' || typeof o.title !== 'string')) {
      errors.push(`${path}.properties.options: Invalid choices`);
    }
  }
  if (n.type === 'MetricWidget' && (typeof props.label !== 'string' || !['string','number'].includes(typeof props.value) || (typeof props.value === 'number' && !Number.isFinite(props.value)))) errors.push(`${path}: Invalid metric`);
  if (n.type === 'MapViewer') {
    const coordinate = (p: unknown) => isObjectLike(p) && Number.isFinite(p.lat) && typeof p.lat === 'number' && p.lat >= -90 && p.lat <= 90 && Number.isFinite(p.lng) && typeof p.lng === 'number' && p.lng >= -180 && p.lng <= 180;
    if ((props.center !== undefined && !coordinate(props.center)) || (props.zoom !== undefined && (typeof props.zoom !== 'number' || !Number.isFinite(props.zoom) || props.zoom < 0 || props.zoom > 22)) ||
      (props.markers !== undefined && (!Array.isArray(props.markers) || props.markers.length > 100 || props.markers.some((p: unknown) => !coordinate(p) || !isObjectLike(p) || typeof p.id !== 'string'))) ||
      (props.routePolyline !== undefined && (!Array.isArray(props.routePolyline) || props.routePolyline.length > 1000 || props.routePolyline.some((p: unknown) => !coordinate(p))))) errors.push(`${path}: Invalid map coordinates`);
  }
  if (n.type === 'ChoiceGroup' && Array.isArray(props.options) && new Set(props.options.map((o: unknown) => (isObjectLike(o) ? o.id : undefined))).size !== props.options.length) errors.push(`${path}: Duplicate choice IDs`);
  if (n.type === 'DataTable' && (!Array.isArray(props.columns) || !Array.isArray(props.rows) ||
      props.columns.length > 100 || props.rows.length > 500 || props.columns.some((column: unknown) => !isPlainRecord(column) || typeof column.key !== 'string' || !column.key || typeof column.title !== 'string') || props.rows.some((row: unknown) => !isPlainRecord(row)))) {
    errors.push(`${path}.properties: Invalid or oversized DataTable`);
  }
  if (n.type === 'MiniAppEmbed' && typeof props.miniAppId !== 'string') {
    errors.push(`${path}.properties.miniAppId: Required string`);
  }
  if (n.style !== undefined && (!n.style || typeof n.style !== 'object' || Array.isArray(n.style))) {
    errors.push(`${path}.style: Must be an object`);
  }
  if (n.children !== undefined) {
    if (!Array.isArray(n.children) || n.children.length > 100) {
      errors.push(`${path}.children: Must be an array (max 100 nodes)`);
    } else {
      n.children.forEach((child: unknown, index: number) => {
        const result = validateUIComponentNode(child, `${path}.children[${index}]`, depth + 1, budget);
        if (result.errors) errors.push(...result.errors);
      });
    }
  }
  if (n.onEvents !== undefined) {
    if (!Array.isArray(n.onEvents) || n.onEvents.length > 10) {
      errors.push(`${path}.onEvents: Must be an array (max 10 events)`);
    } else {
      n.onEvents.forEach((evt: unknown, idx: number) => {
        const prefix = `${path}.onEvents[${idx}]`;
        if (!isObjectLike(evt)) {
          errors.push(`${prefix}: Must be an object`);
          return;
        }
        if (!EVENT_NAMES.some((name) => name === evt.event)) errors.push(`${prefix}: Invalid event '${evt.event}'`);
        if (!ACTION_TYPES.some((name) => name === evt.actionType)) {
          errors.push(`${prefix}: Invalid actionType '${evt.actionType}'`);
        }
        if (!isPlainRecord(evt.payload)) {
          errors.push(`${prefix}: Payload must be an object`);
        } else if (evt.actionType === 'AGENT_ACTION_DISPATCH' &&
            (typeof evt.payload.action !== 'string' || !evt.payload.action)) {
          errors.push(`${prefix}: Agent dispatch requires an action`);
        }
      });
    }
  }
  return errors.length ? { success: false, errors } : { success: true, data: node as UIComponentNode };
}

/**
 * Validate a top-level AG-UI Surface payload
 */
export function validateAGUISurface(data: unknown): ValidationResult<AGUISurfacePayload> {
  const errors: string[] = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, errors: ['Payload must be an object'] };
  }

  const payload = data as Record<string, unknown>;

  if (payload.version !== '1.0.0') {
    errors.push(`Invalid version '${payload.version}'. Expected '1.0.0'`);
  }

  if (typeof payload.sessionId !== 'string' || !payload.sessionId.trim() || payload.sessionId.length > 128) {
    errors.push("Missing or invalid 'sessionId'");
  }

  if ((typeof payload.timestamp === 'number' && (!Number.isFinite(payload.timestamp) || payload.timestamp < 0)) || (typeof payload.timestamp === 'string' && (!payload.timestamp || !Number.isFinite(Date.parse(payload.timestamp)))) || !['number','string'].includes(typeof payload.timestamp)) {
    errors.push("Missing or invalid 'timestamp' (number or string)");
  }

  if (payload.revision !== undefined && (typeof payload.revision !== 'string' || !/^[0-9a-f-]{36}$/.test(payload.revision))) {
    errors.push('Invalid surface revision');
  }
  if (payload.assistantMessage !== undefined) {
    const message = payload.assistantMessage;
    if (!isObjectLike(message) || typeof message.id !== 'string' || !message.id ||
        typeof message.text !== 'string' || !message.text.trim() || message.text.length > 4000) {
      errors.push('Invalid assistant message');
    }
  }
  const viewValidation = validateUIComponentNode(payload.view, 'view');
  if (!viewValidation.success && viewValidation.errors) {
    errors.push(...viewValidation.errors);
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: data as AGUISurfacePayload };
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
  actionPayload: Record<string, unknown>,
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

