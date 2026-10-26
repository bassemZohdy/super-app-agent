/** The one place that decides what a model may see (P1-17). Raw account, meter, card, ledger, case and contact
 *  identifiers never enter model input, with or without consent. Personal context (amounts, balances, dates) is shared
 *  only while the resident's consent is on, and it is read again for every call, so withdrawing it applies to the next one.
 *  Surfaces are filtered by an allowlist of structural properties, so a new property is excluded until it is added here. */
import type { SuperAppAgentState } from './langgraph/state.ts';

export type ModelInputConsent = { personalContext: boolean };

export const REDACTED = '[redacted]';
export const WITHHELD = '[withheld]';

/** Identifier shapes, most specific first. Amounts, dates and plan names are left alone. */
const IDENTIFIERS: readonly RegExp[] = [
  /\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b/g,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\b(?:\d{4}[ -]){3}\d{4}\b/g,
  /\+\d[\d ()-]{7,}\d/g,
  /\b05\d[ -]?\d{3}[ -]?\d{4}\b/g,
  /\b[A-Za-z]{2,10}[_-](?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{5,}\b/g,
  /\b\d{7,}\b/g,
];

/** Removes identifiers from free text. Applied at the model egress as a last net, whatever the caller built. */
export function scrubText(text: string): string {
  let out = text;
  for (const pattern of IDENTIFIERS) out = out.replace(pattern, REDACTED);
  return out;
}

/** Without personal context, any number (amount, balance, date part) is withheld as well. */
export function minimiseText(text: string, consent: ModelInputConsent): string {
  const clean = scrubText(text);
  return consent.personalContext ? clean : clean.replace(/\d[\d,.:/-]*/g, WITHHELD);
}

/** Earlier turns sent back to the model. What the resident typed is their own words and is only scrubbed of identifiers; what the
 *  assistant said was built from service state (balances, amounts, names), so it takes the full minimiser and follows the consent. */
export function minimiseHistory(messages: ReadonlyArray<{ role: string; content: string }>, consent: ModelInputConsent, limit = 4000): Array<{ role: string; content: string }> {
  return messages.map(message => ({ role: message.role, content: (message.role === 'assistant' ? minimiseText(message.content, consent) : scrubText(message.content)).slice(0, limit) }));
}

const STRUCTURE_KEYS = ['variant', 'level', 'trend', 'fullWidth', 'disabled', 'columns'] as const;
const TEXT_KEYS = ['text', 'label', 'value', 'title', 'subtext', 'subtitle', 'name'] as const;
const MAX_DEPTH = 12, MAX_NODES = 200;

type Node = { type?: unknown; id?: unknown; properties?: Record<string, unknown>; children?: unknown };

/** The model-facing copy of a surface view. It is a new tree: the surface streamed to the resident is untouched. */
export function minimiseSurface(view: unknown, consent: ModelInputConsent): unknown {
  let budget = MAX_NODES;
  const walk = (raw: unknown, depth: number): unknown => {
    if (!raw || typeof raw !== 'object' || depth > MAX_DEPTH || budget-- <= 0) return undefined;
    const node = raw as Node, out: Record<string, unknown> = {};
    if (typeof node.type === 'string') out.type = node.type.slice(0, 40);
    const props = node.properties && typeof node.properties === 'object' ? node.properties : {}, kept: Record<string, unknown> = {};
    for (const key of STRUCTURE_KEYS) if (props[key] !== undefined && ['string', 'number', 'boolean'].includes(typeof props[key])) kept[key] = props[key];
    for (const key of TEXT_KEYS) if (typeof props[key] === 'string') kept[key] = minimiseText(props[key] as string, consent).slice(0, 600);
    if (Array.isArray(props.options)) kept.options = props.options.slice(0, 20).map(option => typeof (option as { label?: unknown })?.label === 'string' ? { label: minimiseText((option as { label: string }).label, consent).slice(0, 200) } : {});
    if (Object.keys(kept).length) out.properties = kept;
    if (Array.isArray(node.children)) out.children = node.children.map(child => walk(child, depth + 1)).filter(child => child !== undefined);
    return out;
  };
  return walk(view, 0);
}

/** Consent is read from the session each time a prompt is built, never cached, so a withdrawal applies to the next call.
 *  Until a resident-facing control sets it, the demo keeps sharing; `false` is the only value that withholds. */
export function modelConsentFor(state: Pick<SuperAppAgentState, 'metadata'>): ModelInputConsent {
  return { personalContext: (state.metadata as { modelPersonalContext?: unknown } | undefined)?.modelPersonalContext !== false };
}
