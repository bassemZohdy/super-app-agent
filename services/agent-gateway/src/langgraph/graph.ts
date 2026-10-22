import { AGUISurfacePayload } from '@superapp/protocol-core';
import { SuperAppAgentState, DomainCategory } from './state.js';
import { invokeOpenRouterChat } from '../openrouter.js';

export class SuperAppAgentGraph {
  public static async executeIntent(
    state: SuperAppAgentState,
    prompt: string,
    onProgress?: (delta: string) => void
  ): Promise<SuperAppAgentState> {
    // 1. Append user prompt to state
    state.messages.push({
      id: `msg_${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    });

    onProgress?.('SuperApp Concierge evaluating intent...');

    // 2. Classify domain intent
    const lower = prompt.toLowerCase();
    let targetDomain: DomainCategory = 'concierge';
    if (lower.includes('ride') || lower.includes('cab') || lower.includes('taxi') || lower.includes('car')) {
      targetDomain = 'ride';
    } else if (lower.includes('food') || lower.includes('pizza') || lower.includes('order') || lower.includes('restaurant')) {
      targetDomain = 'food';
    } else if (lower.includes('pay') || lower.includes('wallet') || lower.includes('balance')) {
      targetDomain = 'wallet';
    } else if ((lower.includes('ride') && lower.includes('food')) || lower.includes('both')) {
      targetDomain = 'composite';
    }

    state.activeDomain = targetDomain;
    onProgress?.(`Delegating to ${targetDomain.toUpperCase()} domain agent...`);

    // 3. Compile context-aware AG-UI surface
    const surface = this.generateAGUISurface(state.sessionId, targetDomain, prompt);
    state.currentSurface = surface;

    // 4. Record assistant response
    state.messages.push({
      id: `msg_${Date.now() + 1}`,
      role: 'assistant',
      content: `I have prepared the ${targetDomain} options for you. Please review below.`,
      timestamp: Date.now(),
    });

    return state;
  }

  public static async resumeWithAction(
    state: SuperAppAgentState,
    action: string,
    payload: Record<string, any>,
    onProgress?: (delta: string) => void
  ): Promise<SuperAppAgentState> {
    onProgress?.(`Processing user action: ${action}...`);

    if (action === 'book_ride') {
      state.currentSurface = {
        version: '1.0.0',
        sessionId: state.sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'ride_confirmed_card',
          style: { variant: 'success', padding: 'medium' },
          children: [
            {
              type: 'Heading',
              id: 'confirm_title',
              properties: { text: '🚗 Ride Confirmed!', level: 2 },
            },
            {
              type: 'Text',
              id: 'driver_details',
              properties: {
                text: `Driver Alex (Toyota Camry • Silver • 4.9 ★) is on the way! ETA: 4 minutes.`,
              },
            },
            {
              type: 'MetricWidget',
              id: 'eta_widget',
              properties: { label: 'Arrival Time', value: '4 mins', trend: 'neutral' },
            },
            {
              type: 'Button',
              id: 'btn_track',
              properties: { label: 'Track on Live Map', variant: 'outline', fullWidth: true },
              onEvents: [
                {
                  event: 'onPress',
                  actionType: 'LAUNCH_MINIAPP',
                  payload: { miniAppId: 'org.superapp.ride', entryRoute: '/trip/active' },
                },
              ],
            },
          ],
        },
      };
    } else if (action === 'order_food') {
      state.currentSurface = {
        version: '1.0.0',
        sessionId: state.sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'food_confirmed_card',
          style: { variant: 'success', padding: 'medium' },
          children: [
            {
              type: 'Heading',
              id: 'food_title',
              properties: { text: '🍕 Order Dispatched to Kitchen!', level: 2 },
            },
            {
              type: 'Text',
              id: 'food_desc',
              properties: { text: 'Pizza Napoli has accepted your order. Estimated delivery: 25 mins.' },
            },
            {
              type: 'MetricWidget',
              id: 'food_eta',
              properties: { label: 'Kitchen Prep', value: '12 mins', trend: 'neutral' },
            },
          ],
        },
      };
    }

    return state;
  }

  private static generateAGUISurface(
    sessionId: string,
    domain: DomainCategory,
    prompt: string
  ): AGUISurfacePayload {
    if (domain === 'food') {
      return {
        version: '1.0.0',
        sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'food_options_card',
          style: { padding: 'medium', direction: 'vertical' },
          children: [
            {
              type: 'Heading',
              id: 'heading_food',
              properties: { text: 'Recommended Dining', level: 2 },
            },
            {
              type: 'ChoiceGroup',
              id: 'food_choices',
              properties: {
                selectedId: 'item_pizza',
                options: [
                  { id: 'item_pizza', title: 'Woodfired Pizza Diavola', subtitle: 'Spicy salami, mozzarella', price: '$18.00', badge: 'Popular' },
                  { id: 'item_pasta', title: 'Truffle Tagliatelle', subtitle: 'Fresh pasta, parmesan cream', price: '$22.50', badge: 'Chef Special' },
                ],
              },
            },
            {
              type: 'Button',
              id: 'btn_order_food',
              properties: { label: 'Place Order & Pay via Wallet', variant: 'primary', fullWidth: true },
              onEvents: [
                {
                  event: 'onPress',
                  actionType: 'AGENT_ACTION_DISPATCH',
                  payload: { action: 'order_food', selectedId: 'item_pizza' },
                },
              ],
            },
          ],
        },
      };
    }

    // Default to Ride surface or composite
    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'ride_selection_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'ride_title',
            properties: { text: 'Select Your Ride', level: 2 },
          },
          {
            type: 'ChoiceGroup',
            id: 'ride_choices',
            properties: {
              selectedId: 'ride_comfort',
              options: [
                { id: 'ride_economy', title: 'Economy Cab', subtitle: '4 mins away • 4 seats', price: '$14.50', badge: 'Fastest' },
                { id: 'ride_comfort', title: 'Comfort Sedan', subtitle: '7 mins away • Leather seats', price: '$22.00', badge: 'Top Rated' },
                { id: 'ride_xl', title: 'Executive SUV', subtitle: '10 mins away • 6 seats', price: '$35.00' },
              ],
            },
          },
          {
            type: 'Button',
            id: 'btn_book_comfort',
            properties: { label: 'Confirm Comfort Sedan ($22.00)', variant: 'primary', fullWidth: true },
            onEvents: [
              {
                event: 'onPress',
                actionType: 'AGENT_ACTION_DISPATCH',
                payload: { action: 'book_ride', selectedOption: 'ride_comfort' },
              },
            ],
          },
        ],
      },
    };
  }
}
