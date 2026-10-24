import { randomUUID } from 'node:crypto';
import type { SuperAppAgentState } from './langgraph/state.ts';

/** Bounded conversational helpers; natural-language assent never dispatches an action. */
export function handleConversation(state: SuperAppAgentState, prompt: string): boolean {
  const text = prompt.trim().toLowerCase().replace(/[.!?]+$/g, '');
  let reply: string | undefined;
  if (/^(hi|hello|hey|marhaba|مرحبا|السلام عليكم)(?:[, ]+(?:rashid|there|راشد))?$/.test(text)) {
    reply = 'Hello, I’m Rashid. I can help you get around, check bills and balances, or plan a move. What would you like to take care of?';
  } else if (/^(help|what can you do|how does this work)$/.test(text)) {
    reply = 'Tell me what you need, or use the microphone to draft your request. I will show options and an approval surface. Review the details and use its confirmation button for a booking or payment. These services use demo data.';
  } else if (/^(thanks|thank you|شكرا)$/.test(text)) {
    reply = 'You are welcome. You can ask a follow-up about this proposal or start another request.';
  } else if (/^(yes|yes please|ok|okay|confirm|confirm it|go ahead|do it|book it|pay it|نعم)$/.test(text)) {
    reply = state.currentSurface
      ? 'Please review the current details and use the confirmation button on the surface. A chat or voice response does not approve a booking or payment.'
      : 'Tell me which service you need first. I will prepare options for you to review.';
  } else if (/^(cancel|cancel that|never mind|nevermind|stop|إلغاء)$/.test(text)) {
    reply = 'The current approval has been cleared. Any operations already completed are unchanged; contact the provider to cancel those.';
    state.currentSurface = undefined;
    state.conversationTopic = undefined;
  } else if (/^(explain( this| that| it)?|tell me more|what happens next|what am i confirming|how much is (it|that)|what is (this|that|the status))$/.test(text)) {
    const surface = state.currentSurface;
    if (surface) {
      const details: string[] = [];
      const walk = (node: any) => {
        if (['Heading', 'Text'].includes(node.type) && typeof node.properties?.text === 'string') details.push(node.properties.text);
        if (node.type === 'MetricWidget') details.push(`${node.properties?.label || ''}: ${node.properties?.value || ''}`);
        for (const child of node.children || []) walk(child);
      };
      walk(surface.view);
      reply = `${details.join(' ').slice(0, 2400)} Review all details on the surface. If an approval button is available, use it to proceed.`;
    } else reply = 'Start with a service request, such as showing rides or checking your wallet, and I will explain the available options.';
  }
  if (!reply) return false;
  if (state.currentSurface) state.currentSurface = { ...state.currentSurface };
  else state.currentSurface = {
    version: '1.0.0', sessionId: state.sessionId, timestamp: Date.now(),
    view: { type: 'SurfaceCard', id: 'conversation_card', children: [
      { type: 'Heading', id: 'conversation_heading', properties: { text: 'Your concierge' } },
      { type: 'Text', id: 'conversation_text', properties: { text: reply } },
    ] },
  };
  state.messages.push({ id: randomUUID(), role: 'assistant', content: reply, timestamp: Date.now() });
  return true;
}

export function contextualPrompt(state: SuperAppAgentState, prompt: string): string {
  const followUp = /^(show( me)? (the )?(options|alternatives|that again)|refresh( that)?)[.!?]*$/i.test(prompt.trim());
  if (followUp && state.conversationTopic) return state.conversationTopic;
  state.conversationTopic = prompt;
  return prompt;
}
