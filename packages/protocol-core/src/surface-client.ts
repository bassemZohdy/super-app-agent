import { validateAGUISurface, type AGUISurfacePayload, type UIComponentNode, type ActionBinding } from './ag-ui.ts';

export function choiceDefaults(view: UIComponentNode): Record<string, string> {
  const choices: Record<string, string> = {};
  const walk = (node: UIComponentNode) => {
    if (node.type === 'ChoiceGroup') {
      const options = node.properties?.options || [];
      const selected = options.find((option) => option.id === node.properties?.selectedId) || options[0];
      if (selected) choices[node.id] = selected.id;
    }
    node.children?.forEach(walk);
  };
  walk(view);
  return choices;
}

/** Current dispatch contract supports one choice group per card; reject ambiguity. */
export function surfaceActionPayload(view: UIComponentNode, binding: ActionBinding,
  choices: Record<string, string>, formValues: Record<string, unknown> = {}): Record<string, unknown> {
  if (binding.actionType !== 'AGENT_ACTION_DISPATCH') throw new Error('This navigation action is not supported in this shell.');
  const groups = Object.keys(choiceDefaults(view));
  if (groups.length > 1) throw new Error('This surface has multiple choice groups and requires an explicit action binding.');
  const payload = { ...binding.payload, ...formValues };
  delete payload.selectedChoice;
  if (groups.length === 1) {
    const groupId = groups[0];
    const selectedChoice = choices[groupId];
    let valid = false;
    const walk = (node: UIComponentNode) => {
      if (node.id === groupId) valid = node.properties?.options?.some((option) => option.id === selectedChoice) === true;
      node.children?.forEach(walk);
    };
    walk(view);
    if (!valid) throw new Error('Choose an available option before continuing.');
    payload.selectedChoice = selectedChoice;
  }
  return payload;
}

export function checkedSurface(surface: unknown, sessionId: string): AGUISurfacePayload {
  const result = validateAGUISurface(surface);
  if (!result.success || result.data?.sessionId !== sessionId || !result.data.revision) {
    throw new Error('The gateway returned an invalid surface. Refresh your request.');
  }
  return result.data;
}

/** Read error bodies as well as successes so the caller can show warning surfaces. */
export async function readCoreResponse(response: Response, sessionId: string): Promise<{
  surface?: AGUISurfacePayload; error?: string;
}> {
  const data = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid gateway response.');
  const surface = data.surface === undefined ? undefined : checkedSurface(data.surface, sessionId);
  if (!response.ok || data.success !== true) {
    return { surface, error: typeof data.error === 'string' ? data.error : `Request failed (${response.status}).` };
  }
  if (!surface) throw new Error('The gateway returned no surface.');
  return { surface };
}
