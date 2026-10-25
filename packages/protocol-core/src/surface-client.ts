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

interface ChoiceScope { id: string; options: string[] }

/** Every choice group on the surface is in scope of every dispatch. */
function choiceScope(view: UIComponentNode): ChoiceScope[] {
  const scope: ChoiceScope[] = [];
  const walk = (node: UIComponentNode) => {
    if (node.type === 'ChoiceGroup') {
      const options = (node.properties?.options || []).map(option => option.id);
      if (options.length) scope.push({ id: node.id, options });
    }
    node.children?.forEach(walk);
  };
  walk(view);
  return scope;
}

/** One group emits selectedChoice; several emit a selectedChoices map keyed by group id. */
export function surfaceActionPayload(view: UIComponentNode, binding: ActionBinding,
  choices: Record<string, string>, formValues: Record<string, unknown> = {}): Record<string, unknown> {
  if (binding.actionType !== 'AGENT_ACTION_DISPATCH') throw new Error('This navigation action is not supported in this shell.');
  // Server-bound keys are authoritative: client form values may not overwrite them.
  const payload = { ...formValues, ...binding.payload };
  delete payload.selectedChoice;
  delete payload.selectedChoices;
  const selectedChoices: Record<string, string> = {};
  for (const group of choiceScope(view)) {
    if (!group.options.includes(choices[group.id])) throw new Error('Choose an available option before continuing.');
    selectedChoices[group.id] = choices[group.id];
  }
  const groupIds = Object.keys(selectedChoices);
  if (groupIds.length === 1) payload.selectedChoice = selectedChoices[groupIds[0]];
  else if (groupIds.length > 1) payload.selectedChoices = selectedChoices;
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
