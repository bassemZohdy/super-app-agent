import { randomUUID } from 'node:crypto';
import { BaseCheckpointSaver, Annotation, StateGraph, START, END, MemorySaver, interrupt, Command } from '@langchain/langgraph';
import { SuperAppAgentGraph } from './graph.ts';
import type { SuperAppAgentState } from './state.ts';
import { hasActionBindings } from '../approvals.ts';
import { RedisGraphSaver } from './checkpointer.ts';

type Action = { action: string; payload: Record<string, unknown> };
const Schema = Annotation.Root({ session: Annotation<SuperAppAgentState>(), intent: Annotation<string | undefined>(), manualService: Annotation<string | undefined>(), action: Annotation<Action>() });
const progress = new Map<string, (text: string) => void>();
function compile(persistent: boolean) {
  return new StateGraph(Schema)
    .addNode('prepare', async state => ({ session: state.manualService ? await SuperAppAgentGraph.executeService(state.session, state.manualService, progress.get(state.session.sessionId)) : await SuperAppAgentGraph.executeIntent(state.session, state.intent!, progress.get(state.session.sessionId)) }))
    .addNode('review', state => ({ action: interrupt({ kind: 'review-service-action', sessionId: state.session.sessionId, surface: state.session.currentSurface?.view }) as Action }))
    .addNode('execute', async state => ({ session: await SuperAppAgentGraph.resumeWithAction(state.session, state.action.action, state.action.payload, progress.get(state.session.sessionId)) }))
    .addConditionalEdges(START, state => state.intent ? 'prepare' : 'review', ['prepare','review'])
    .addConditionalEdges('prepare', state => state.session.currentSurface && hasActionBindings(state.session.currentSurface.view) ? 'review' : END, ['review',END])
    .addEdge('review', 'execute').addEdge('execute', END)
    .compile({ checkpointer: persistent ? new RedisGraphSaver() : new MemorySaver() });
}
let memory: ReturnType<typeof compile> | undefined, redis: ReturnType<typeof compile> | undefined;
export async function discardRuntime(state: SuperAppAgentState) {
  const id = state.metadata?.runtime?.threadId;
  if (typeof id === 'string') await (graph().checkpointer as BaseCheckpointSaver).deleteThread(id);
}
const graph = () => process.env.SESSION_STORE === 'redis' ? redis ||= compile(true) : memory ||= compile(false);
const options = (threadId: string) => ({ configurable: { thread_id: threadId }, recursionLimit: 8 });
const thread = (state: SuperAppAgentState) => `cityside:${state.sessionId}:${randomUUID()}`;

export async function executeRuntimeIntent(state: SuperAppAgentState, text: string, onProgress?: (text: string) => void, manualService?: string) {
  await discardRuntime(state);
  const id = thread(state);
  if (onProgress) progress.set(state.sessionId, onProgress);
  try {
    const result = await graph().invoke({ session: structuredClone(state), intent: text, manualService }, options(id));
    Object.assign(state, result.session);
    const snapshot = await graph().getState(options(id));
    state.metadata = { ...state.metadata, runtime: { version: 1, threadId: id, status: snapshot.next.includes('review') ? 'awaiting-approval' : 'complete' } };
    return state;
  } finally { progress.delete(state.sessionId); }
}

export async function executeRuntimeAction(state: SuperAppAgentState, action: string, payload: Record<string, unknown>, onProgress?: (text: string) => void) {
  let id = state.metadata?.runtime?.threadId as string | undefined;
  if (onProgress) progress.set(state.sessionId, onProgress);
  try {
    if (!id || state.metadata?.runtime?.status !== 'awaiting-approval') {
      id = thread(state);
      await graph().invoke({ session: structuredClone(state), intent: undefined }, options(id));
    }
    const result = await graph().invoke(new Command({ resume: { action, payload } }), options(id));
    const history = state.approvalHistory;
    Object.assign(state, result.session);
    state.approvalHistory = history;
    await (graph().checkpointer as BaseCheckpointSaver).deleteThread(id);
    state.metadata = { ...state.metadata, runtime: { version: 1, threadId: id, status: 'complete' } };
    return state;
  } finally { progress.delete(state.sessionId); }
}
