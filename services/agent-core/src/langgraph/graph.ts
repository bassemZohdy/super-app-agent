import type { AGUISurfacePayload, UIComponentNode } from '../../../../packages/protocol-core/src/index.ts';
import type { SuperAppAgentState, DomainCategory } from './state.ts';
import { invokeOpenRouterChat, getOpenRouterConfig } from '../openrouter.ts';

import { executeRideRequest } from '../../../service-ride/src/index.ts';
import { executeFoodRequest } from '../../../service-food/src/index.ts';
import { executeWalletRequest } from '../../../service-wallet/src/index.ts';
import { executeCatalogRequest } from '../../../service-catalog/src/index.ts';
import { executeProfileRequest, type UserProfile, type UserPreferences } from '../../../service-profile/src/index.ts';

export class SuperAppAgentGraph {
  /**
   * Primary entrypoint: User expresses intent via natural language text
   */
  public static async executeIntent(
    state: SuperAppAgentState,
    prompt: string,
    onProgress?: (delta: string) => void
  ): Promise<SuperAppAgentState> {
    // 1. Record user turn
    state.messages.push({
      id: `msg_${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    });

    onProgress?.('🧠 Concierge Supervisor analyzing user request...');

    // 2. Fetch User Profile and Personalization Context
    const profileRes = executeProfileRequest('GET', '/profile/prompt-context');
    const profile: UserProfile = profileRes.data.profile;
    const preferences: UserPreferences = profileRes.data.preferences;

    onProgress?.(`👤 Applying personalization for ${profile.displayName} (${profile.vipTier}) • Dietary: ${preferences.dietary.join(', ')}...`);

    // 3. Classify domain intent
    const lower = prompt.toLowerCase();
    let targetDomain: DomainCategory = 'concierge';

    const hasRideAction = lower.includes('ride') || lower.includes('cab') || lower.includes('taxi') || lower.includes('car') || lower.includes('drive');
    const hasFoodAction = lower.includes('food') || lower.includes('restaurant') || lower.includes('lunch') || lower.includes('dinner') || lower.includes('pizza') || lower.includes('order') || lower.includes('menu') || lower.includes('dining') || lower.includes('eat') || lower.includes('dish');
    const hasWalletAction = lower.includes('pay') || lower.includes('wallet') || lower.includes('balance') || lower.includes('topup') || lower.includes('top up') || lower.includes('ledger');
    const hasProfileIntent = lower.includes('profile') || lower.includes('preference') || lower.includes('dietary') || lower.includes('tier') || lower.includes('vip');

    const isExplicitComposite = (hasRideAction && hasFoodAction && (lower.includes('and') || lower.includes('both') || lower.includes('with'))) ||
      (lower.includes('both') && (hasRideAction || hasFoodAction));

    if (isExplicitComposite) {
      targetDomain = 'composite';
    } else if (hasRideAction) {
      targetDomain = 'ride';
    } else if (hasFoodAction) {
      targetDomain = 'food';
    } else if (hasWalletAction) {
      targetDomain = 'wallet';
    }

    state.activeDomain = targetDomain;

    // Check if OpenRouter API is configured for live LLM reasoning
    const openRouterConfig = getOpenRouterConfig();
    if (openRouterConfig.apiKey) {
      onProgress?.(`⚡ Routing to OpenRouter (${openRouterConfig.model}) with Profile context...`);
      try {
        await invokeOpenRouterChat([
          { role: 'system', content: `You are the SuperApp Autonomous Concierge.\n${profileRes.data.promptContext}` },
          { role: 'user', content: prompt },
        ]);
      } catch (err: any) {
        onProgress?.(`⚠️ OpenRouter notice: ${err.message}. Proceeding with deterministic LangGraph StateGraph.`);
      }
    }

    // 4. Cognitive Domain Routing & Microservice Tool Execution
    if (targetDomain === 'composite') {
      onProgress?.('🔀 Orchestrating composite workflow across Ride, Food, and Wallet microservices...');

      // Invoke tools concurrently
      const rideRes = executeRideRequest('GET', '/rides/options', { destination: 'Downtown Dining' });
      const foodRes = executeFoodRequest('GET', '/restaurants/search', { query: 'pizza' });
      const walletRes = executeWalletRequest('GET', '/wallet/balance');

      onProgress?.('📋 Compiling unified AG-UI surface with interactive Human-In-The-Loop checkpoint...');
      state.currentSurface = this.buildCompositeSurface(state.sessionId, rideRes.data, foodRes.data, walletRes.data, profile, preferences);
      state.messages.push({
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `I've prepared a personalized itinerary for ${profile.displayName} with your favored ${preferences.mobility.preferredTierName} and pizza matching your dietary preferences.`,
        timestamp: Date.now(),
      });
    } else if (targetDomain === 'ride') {
      onProgress?.('🚖 Querying Ride Microservice for real-time drivers & fare estimates...');
      const rideRes = executeRideRequest('GET', '/rides/options', { destination: 'Downtown' });

      onProgress?.(`🗺️ Rendering route map and highlighting ${preferences.mobility.preferredTierName}...`);
      state.currentSurface = this.buildRideSelectionSurface(state.sessionId, rideRes.data.options, profile, preferences);
      state.messages.push({
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `Here are available rides near you. We've highlighted your preferred ${preferences.mobility.preferredTierName}.`,
        timestamp: Date.now(),
      });
    } else if (targetDomain === 'food') {
      onProgress?.('🍕 Querying Food Microservice for menus and restaurant availability...');
      const foodRes = executeFoodRequest('GET', '/restaurants/search', { query: 'pizza' });

      onProgress?.(`🍽️ Filtering and badging dining options for ${preferences.dietary.join(', ')}...`);
      state.currentSurface = this.buildFoodSelectionSurface(state.sessionId, foodRes.data.restaurants, profile, preferences);
      state.messages.push({
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `Found dining options tailored to your preferences (${preferences.dietary.join(', ')}).`,
        timestamp: Date.now(),
      });
    } else if (targetDomain === 'wallet') {
      onProgress?.('💳 Querying Wallet Microservice for balances and ledger history...');
      const walletRes = executeWalletRequest('GET', '/wallet/balance');
      const txRes = executeWalletRequest('GET', '/wallet/transactions');

      onProgress?.(`📊 Building secure wallet overview with ${profile.vipTier} member benefits...`);
      state.currentSurface = this.buildWalletOverviewSurface(state.sessionId, walletRes.data.balance, txRes.data.transactions, profile);
      state.messages.push({
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `Welcome back, ${profile.displayName}! Your wallet balance is $${walletRes.data.balance} with active ${profile.vipTier} status.`,
        timestamp: Date.now(),
      });
    } else if (hasProfileIntent) {
      onProgress?.('👤 Compiling User Profile & Preferences card...');
      state.currentSurface = this.buildProfileOverviewSurface(state.sessionId, profile, preferences);
      state.messages.push({
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `Here is your SuperApp Profile & Personalization settings, ${profile.displayName}.`,
        timestamp: Date.now(),
      });
    } else {
      // General Concierge welcome / catalog query
      onProgress?.('📦 Fetching registered mini-apps from Service Catalog...');
      const catalogRes = executeCatalogRequest('GET', '/miniapps');

      state.currentSurface = this.buildConciergeCatalogSurface(state.sessionId, catalogRes.data.miniApps, profile);
      state.messages.push({
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `Hello ${profile.displayName}! I am your SuperApp Concierge. You can ask me to book rides, order food, or update your preferences.`,
        timestamp: Date.now(),
      });
    }

    return state;
  }

  /**
   * Action Loop entrypoint: User interacts with an AG-UI card
   */
  public static async resumeWithAction(
    state: SuperAppAgentState,
    action: string,
    payload: Record<string, any>,
    onProgress?: (delta: string) => void
  ): Promise<SuperAppAgentState> {
    onProgress?.(`⚡ Processing AG-UI action: ${action}...`);

    if (action === 'book_ride') {
      onProgress?.('🚖 Dispatching driver via Ride Microservice...');
      const res = executeRideRequest('POST', '/rides/book', {}, {
        driverId: payload.selectedChoice || payload.driverId || 'drv_1',
        pickup: '100 Market St',
        dropoff: 'Downtown Restaurant',
      });

      const booking = res.data.booking;
      state.currentSurface = {
        version: '1.0.0',
        sessionId: state.sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'ride_confirmed_card',
          style: { variant: 'success', padding: 'medium', direction: 'vertical' },
          children: [
            {
              type: 'Heading',
              id: 'confirm_title',
              properties: { text: '🚗 Ride Dispatched & En Route!', level: 2 },
            },
            {
              type: 'Text',
              id: 'driver_details',
              properties: {
                text: `Driver ${booking.driver.name} (${booking.driver.car} • ${booking.driver.rating} ★) is arriving! ETA: ${booking.etaMinutes} minutes.`,
              },
            },
            {
              type: 'MapViewer',
              id: 'ride_tracking_map',
              properties: {
                center: { lat: booking.driver.lat, lng: booking.driver.lng },
                zoom: 14,
                markers: [
                  { id: 'driver_car', lat: booking.driver.lat, lng: booking.driver.lng, title: 'Your Driver' },
                  { id: 'pickup_pin', lat: 37.7749, lng: -122.4194, title: 'Pickup' },
                ],
              },
            },
            {
              type: 'MetricWidget',
              id: 'eta_widget',
              properties: { label: 'Arrival Time', value: `${booking.etaMinutes} mins`, trend: 'neutral' },
            },
            {
              type: 'Button',
              id: 'btn_track_ride',
              properties: { label: 'Open Ride Mini-App Workspace', variant: 'outline', fullWidth: true },
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
      onProgress?.('🍕 Creating food order with kitchen...');
      const res = executeFoodRequest('POST', '/orders/create', {}, {
        restaurantId: 'rest_1',
        items: [payload.selectedChoice || 'item_diavola'],
        deliveryAddress: '100 Market St, Apt 4B',
      });

      const order = res.data.order;
      state.currentSurface = {
        version: '1.0.0',
        sessionId: state.sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'food_confirmed_card',
          style: { variant: 'success', padding: 'medium', direction: 'vertical' },
          children: [
            {
              type: 'Heading',
              id: 'food_title',
              properties: { text: '🍕 Kitchen Accepted Order!', level: 2 },
            },
            {
              type: 'Text',
              id: 'food_desc',
              properties: {
                text: `${order.restaurantName} is preparing your fresh order. Estimated delivery: ${order.estimatedDeliveryTime}. Total: $${order.totalAmount}.`,
              },
            },
            {
              type: 'MetricWidget',
              id: 'prep_time',
              properties: { label: 'Kitchen Prep', value: '15 mins', trend: 'neutral' },
            },
            {
              type: 'Button',
              id: 'btn_track_food',
              properties: { label: 'Open Food Mini-App Workspace', variant: 'outline', fullWidth: true },
              onEvents: [
                {
                  event: 'onPress',
                  actionType: 'LAUNCH_MINIAPP',
                  payload: { miniAppId: 'org.superapp.food', entryRoute: '/order/status' },
                },
              ],
            },
          ],
        },
      };
    } else if (action === 'confirm_composite_checkout') {
      onProgress?.('💳 Deducting $40.00 from Wallet for ride + food combo...');
      const payRes = executeWalletRequest('POST', '/wallet/pay', {}, {
        amount: 40.0,
        purpose: 'Ride to Downtown + Woodfired Pizza',
      });

      onProgress?.('🚖 Dispatching Comfort Sedan...');
      executeRideRequest('POST', '/rides/book', {}, { driverId: 'drv_1' });

      onProgress?.('🍕 Dispatching Pizza Napoli kitchen order...');
      executeFoodRequest('POST', '/orders/create', {}, { restaurantId: 'rest_1' });

      state.currentSurface = {
        version: '1.0.0',
        sessionId: state.sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'composite_success_card',
          style: { variant: 'success', padding: 'medium', direction: 'vertical' },
          children: [
            {
              type: 'Heading',
              id: 'composite_title',
              properties: { text: '🎉 Both Bookings Confirmed & Paid!', level: 2 },
            },
            {
              type: 'Text',
              id: 'composite_desc',
              properties: {
                text: `Payment of $40.00 settled from wallet. Remaining balance: $${payRes.data.remainingBalance}.`,
              },
            },
            {
              type: 'MetricWidget',
              id: 'widget_ride_eta',
              properties: { label: 'Cab ETA (Alex M.)', value: '4 mins', trend: 'neutral' },
            },
            {
              type: 'MetricWidget',
              id: 'widget_food_eta',
              properties: { label: 'Pizza Napoli Delivery', value: '25 mins', trend: 'neutral' },
            },
          ],
        },
      };
    } else if (action === 'topup_wallet') {
      const topupAmount = payload.amount || 50.0;
      onProgress?.(`💳 Adding $${topupAmount} to wallet...`);
      const res = executeWalletRequest('POST', '/wallet/topup', {}, { amount: topupAmount });

      state.currentSurface = {
        version: '1.0.0',
        sessionId: state.sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'wallet_topup_card',
          style: { variant: 'success', padding: 'medium' },
          children: [
            {
              type: 'Heading',
              id: 'topup_title',
              properties: { text: '💳 Wallet Reloaded Successfully!', level: 2 },
            },
            {
              type: 'MetricWidget',
              id: 'new_balance',
              properties: { label: 'Updated Balance', value: `$${res.data.newBalance}`, trend: 'up' },
            },
          ],
        },
      };
    } else if (action === 'update_preferences') {
      onProgress?.('👤 Updating user preferences in Profile Microservice...');
      const updateRes = executeProfileRequest('POST', '/profile/preferences', {}, payload);
      const profile = executeProfileRequest('GET', '/profile').data.profile;

      state.currentSurface = this.buildProfileOverviewSurface(state.sessionId, profile, updateRes.data.preferences);
      state.messages.push({
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: `Preferences updated successfully! Future ride and food suggestions will immediately reflect these settings.`,
        timestamp: Date.now(),
      });
    }

    return state;
  }

  // --------------------------------------------------------------------------
  // AG-UI Declarative Surface Builders with Dynamic Personalization
  // --------------------------------------------------------------------------

  private static buildRideSelectionSurface(
    sessionId: string,
    drivers: any[],
    profile?: UserProfile,
    preferences?: UserPreferences
  ): AGUISurfacePayload {
    const preferredId = preferences?.mobility?.preferredTier || drivers[0].id;

    const options = drivers.map((d) => {
      const isPreferred = d.id === preferredId;
      let badge = d.etaMinutes <= 4 ? 'Fastest' : 'Comfort';
      if (isPreferred) {
        badge = preferences?.mobility?.ecoFriendlyOnly ? '🌱 Eco EV Preferred' : '⭐ Your Favorite';
      }

      return {
        id: d.id,
        title: `${d.car}`,
        subtitle: `${d.name} • ${d.etaMinutes} mins away • ${d.rating} ★`,
        price: `$${d.fare.toFixed(2)}`,
        badge,
      };
    });

    // Sort user's preferred vehicle to top if available
    options.sort((a, b) => (a.id === preferredId ? -1 : b.id === preferredId ? 1 : 0));

    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'ride_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'ride_heading',
            properties: { text: `🚗 Select Ride Tier for ${profile?.displayName || 'You'}`, level: 2 },
          },
          {
            type: 'Text',
            id: 'ride_pref_summary',
            properties: {
              text: `Tailored for ${profile?.vipTier || 'VIP'} • Preference: ${preferences?.mobility?.preferredTierName || 'Comfort'}`,
              muted: true,
            },
          },
          {
            type: 'MapViewer',
            id: 'ride_overview_map',
            properties: {
              center: { lat: 37.7749, lng: -122.4194 },
              zoom: 13,
              markers: drivers.map((d) => ({ id: d.id, lat: d.lat, lng: d.lng, title: d.car })),
            },
          },
          {
            type: 'ChoiceGroup',
            id: 'ride_choices',
            properties: {
              selectedId: preferredId,
              options,
            },
          },
          {
            type: 'Button',
            id: 'btn_confirm_ride',
            properties: { label: 'Confirm & Dispatch Driver', variant: 'primary', fullWidth: true },
            onEvents: [
              {
                event: 'onPress',
                actionType: 'AGENT_ACTION_DISPATCH',
                payload: { action: 'book_ride' },
              },
            ],
          },
        ],
      },
    };
  }

  private static buildFoodSelectionSurface(
    sessionId: string,
    restaurants: any[],
    profile?: UserProfile,
    preferences?: UserPreferences
  ): AGUISurfacePayload {
    const userDietary = preferences?.dietary || [];

    const allDishes = restaurants.flatMap((r) =>
      r.items.map((item: any) => {
        const itemDietary: string[] = item.dietary || [];
        const matchesPref = userDietary.some((d) => itemDietary.includes(d));
        let badge = itemDietary[0] || 'Popular';
        if (matchesPref) {
          badge = `🌟 Recommended (${itemDietary.join('/')})`;
        }

        return {
          id: item.id,
          title: item.name,
          subtitle: `${r.name} • ${item.description}`,
          price: `$${item.price.toFixed(2)}`,
          badge,
          matchesPref,
        };
      })
    );

    // Sort dishes matching user preferences to the top
    allDishes.sort((a, b) => (a.matchesPref === b.matchesPref ? 0 : a.matchesPref ? -1 : 1));

    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'food_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'food_heading',
            properties: { text: '🍕 Recommended Dining Options', level: 2 },
          },
          {
            type: 'Text',
            id: 'food_pref_note',
            properties: {
              text: `Personalized for ${profile?.displayName || 'User'} • Filters: ${userDietary.join(', ')}`,
              muted: true,
            },
          },
          {
            type: 'ChoiceGroup',
            id: 'food_choices',
            properties: {
              selectedId: allDishes[0]?.id || 'item_diavola',
              options: allDishes,
            },
          },
          {
            type: 'Button',
            id: 'btn_order_food',
            properties: { label: 'Order Dish & Dispatch to Kitchen', variant: 'primary', fullWidth: true },
            onEvents: [
              {
                event: 'onPress',
                actionType: 'AGENT_ACTION_DISPATCH',
                payload: { action: 'order_food' },
              },
            ],
          },
        ],
      },
    };
  }

  private static buildWalletOverviewSurface(
    sessionId: string,
    balance: number,
    txs: any[],
    profile?: UserProfile
  ): AGUISurfacePayload {
    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'wallet_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'wallet_heading',
            properties: { text: `💳 SuperApp Wallet • ${profile?.displayName || 'Active Account'}`, level: 2 },
          },
          {
            type: 'Badge',
            id: 'vip_badge',
            properties: {
              text: `👑 ${profile?.vipTier || 'Gold VIP'} Member • 5% Instant Cashback Active`,
              variant: 'success',
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_balance',
            properties: { label: 'Active Balance', value: `$${balance.toFixed(2)}`, trend: 'neutral' },
          },
          {
            type: 'DataTable',
            id: 'tx_table',
            properties: {
              columns: [
                { key: 'type', title: 'Type' },
                { key: 'purpose', title: 'Description' },
                { key: 'amount', title: 'Amount' },
              ],
              rows: txs.slice(0, 4).map((t) => ({
                type: t.type,
                purpose: t.purpose,
                amount: `${t.type === 'PAYMENT' ? '-' : '+'}$${t.amount.toFixed(2)}`,
              })),
            },
          },
          {
            type: 'Button',
            id: 'btn_topup_50',
            properties: { label: 'Quick Top-Up ($50.00)', variant: 'outline', fullWidth: true },
            onEvents: [
              {
                event: 'onPress',
                actionType: 'AGENT_ACTION_DISPATCH',
                payload: { action: 'topup_wallet', amount: 50.0 },
              },
            ],
          },
        ],
      },
    };
  }

  private static buildProfileOverviewSurface(
    sessionId: string,
    profile: UserProfile,
    preferences: UserPreferences
  ): AGUISurfacePayload {
    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'profile_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'prof_title',
            properties: { text: `👤 Personal Profile: ${profile.displayName}`, level: 2 },
          },
          {
            type: 'Badge',
            id: 'prof_vip',
            properties: { text: `Tier: ${profile.vipTier}`, variant: 'primary' },
          },
          {
            type: 'MetricWidget',
            id: 'metric_diet',
            properties: {
              label: 'Dietary Preferences',
              value: preferences.dietary.join(', ') || 'None',
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_mob',
            properties: {
              label: 'Mobility Preference',
              value: preferences.mobility.preferredTierName,
            },
          },
          {
            type: 'Button',
            id: 'btn_toggle_vegan',
            properties: {
              label: 'Toggle Vegan / Gluten-Free Filter',
              variant: 'outline',
              fullWidth: true,
            },
            onEvents: [
              {
                event: 'onPress',
                actionType: 'AGENT_ACTION_DISPATCH',
                payload: {
                  action: 'update_preferences',
                  dietary: ['Vegan', 'Gluten-Free'],
                },
              },
            ],
          },
        ],
      },
    };
  }

  private static buildCompositeSurface(
    sessionId: string,
    rideData: any,
    foodData: any,
    walletData: any,
    profile?: UserProfile,
    preferences?: UserPreferences
  ): AGUISurfacePayload {
    const preferredTierId = preferences?.mobility?.preferredTier;
    const selectedRide = rideData.options.find((o: any) => o.id === preferredTierId) || rideData.options[0];
    const selectedFood = foodData.restaurants[0].items[0];
    const totalEst = selectedRide.fare + selectedFood.price;

    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'composite_orchestrator_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'comp_title',
            properties: { text: `✨ Multi-Service Concierge for ${profile?.displayName || 'You'}`, level: 2 },
          },
          {
            type: 'Badge',
            id: 'vip_status_badge',
            properties: { text: `👑 ${profile?.vipTier || 'Gold VIP'} Tier Active`, variant: 'success' },
          },
          {
            type: 'Text',
            id: 'comp_summary',
            properties: {
              text: `Autonomous cross-domain plan tailored to your preferences (${preferences?.mobility?.preferredTierName}, ${preferences?.dietary?.join('/')}):`,
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_cab',
            properties: {
              label: `1. Cab: ${selectedRide.car}`,
              value: `$${selectedRide.fare.toFixed(2)} (ETA ${selectedRide.etaMinutes}m)`,
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_dinner',
            properties: {
              label: `2. Dinner: ${selectedFood.name}`,
              value: `$${selectedFood.price.toFixed(2)}`,
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_wallet_status',
            properties: {
              label: '3. Wallet Balance Available',
              value: `$${walletData.balance.toFixed(2)}`,
              trend: 'neutral',
            },
          },
          {
            type: 'Button',
            id: 'btn_confirm_both',
            properties: {
              label: `Authorize Both & Pay $${totalEst.toFixed(2)}`,
              variant: 'primary',
              fullWidth: true,
            },
            onEvents: [
              {
                event: 'onPress',
                actionType: 'AGENT_ACTION_DISPATCH',
                payload: { action: 'confirm_composite_checkout' },
              },
            ],
          },
        ],
      },
    };
  }

  private static buildConciergeCatalogSurface(
    sessionId: string,
    miniApps: any[],
    profile?: UserProfile
  ): AGUISurfacePayload {
    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'catalog_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'cat_title',
            properties: { text: `🌟 Welcome to SuperApp, ${profile?.displayName || 'Guest'}!`, level: 2 },
          },
          {
            type: 'Text',
            id: 'cat_desc',
            properties: {
              text: 'Ask the agent anything in natural language, or explore the installed domains:',
            },
          },
          ...miniApps.map((app: any) => ({
            type: 'MetricWidget' as const,
            id: `app_${app.id}`,
            properties: {
              label: `${app.name} (${app.category})`,
              value: `v${app.version}`,
              subtext: app.description,
            },
          })),
        ],
      },
    };
  }
}
