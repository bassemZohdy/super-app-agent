import type { AGUISurfacePayload, UIComponentNode } from '../../../../packages/protocol-core/src/index.ts';
import type { SuperAppAgentState, DomainCategory } from './state.ts';
import { invokeOpenRouterChat, getOpenRouterConfig } from '../openrouter.ts';

import { callDomain } from '../domain-operations.ts';
import type { UserProfile, UserPreferences } from '../../../service-profile/src/index.ts';
const executeRideRequest = (method: string, path: string, query: Record<string, string> = {}, body: any = {}) => callDomain('ride', method, path, query, body);
const executeFoodRequest = (method: string, path: string, query: Record<string, string> = {}, body: any = {}) => callDomain('food', method, path, query, body);
const executeWalletRequest = (method: string, path: string, query: Record<string, string> = {}, body: any = {}) => callDomain('wallet', method, path, query, body);
const executeCatalogRequest = (method: string, path: string, query: Record<string, string> = {}, body: any = {}) => callDomain('catalog', method, path, query, body);
const executeProfileRequest = (method: string, path: string, query: Record<string, string> = {}, body: any = {}) => callDomain('profile', method, path, query, body);

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

    // 3. Classify smart city domain intent
    const lower = prompt.toLowerCase();
    let targetDomain: DomainCategory = 'concierge';

    // Smart Mobility Intent (RTA / Mawaqif Parking, Salik / Darb Toll, DEWA EV Chargers, Ride)
    const hasParkingAction = lower.includes('parking') || lower.includes('park') || lower.includes('meter') || lower.includes('zone');
    const hasSalikAction = lower.includes('salik') || lower.includes('darb') || lower.includes('toll');
    const hasEVAction = lower.includes('ev') || lower.includes('charger') || lower.includes('charging');
    const hasRideAction = hasParkingAction || hasSalikAction || hasEVAction || lower.includes('ride') || lower.includes('cab') || lower.includes('taxi') || lower.includes('car') || lower.includes('drive');

    // Smart Utilities Intent (DEWA / ADDC Electricity & Water, Smart Meters, Bills)
    const hasUtilitiesAction = lower.includes('dewa') || lower.includes('addc') || lower.includes('electricity') || lower.includes('water') || lower.includes('utility') || lower.includes('utilities') || lower.includes('consumption') || lower.includes('power');
    const hasFoodAction = hasUtilitiesAction || lower.includes('food') || lower.includes('restaurant') || lower.includes('lunch') || lower.includes('dinner') || lower.includes('pizza') || lower.includes('order') || lower.includes('menu') || lower.includes('dining') || lower.includes('eat') || lower.includes('dish');

    // Citizen Pay & Police Fines Intent (Dubai Police, Abu Dhabi Police, Traffic Violations, Wallet)
    const hasPoliceAction = lower.includes('fine') || lower.includes('fines') || lower.includes('police') || lower.includes('radar') || lower.includes('speeding') || lower.includes('violation');
    const hasWalletAction = hasPoliceAction || lower.includes('pay') || lower.includes('wallet') || lower.includes('balance') || lower.includes('topup') || lower.includes('top up') || lower.includes('ledger') || lower.includes('dubaipay') || lower.includes('tamm');

    // Housing & Tenancy Move-In Golden Path (Ejari / Tawtheeq)
    const hasHousingAction = lower.includes('ejari') || lower.includes('tawtheeq') || lower.includes('move-in') || lower.includes('move in') || lower.includes('tenancy') || lower.includes('lease');
    const hasProfileIntent = lower.includes('profile') || lower.includes('uae pass') || lower.includes('uaepass') || lower.includes('emirates id') || lower.includes('golden visa') || lower.includes('preference') || lower.includes('dietary') || lower.includes('tier') || lower.includes('vip');

    // Multi-Agency Composite Journeys
    const isExplicitComposite = hasHousingAction ||
      (hasUtilitiesAction && (hasPoliceAction || hasWalletAction || hasSalikAction)) ||
      ((hasRideAction || hasParkingAction) && (hasFoodAction || hasUtilitiesAction) && (lower.includes('and') || lower.includes('both') || lower.includes('with'))) ||
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
    if (openRouterConfig.apiKey && process.env.ENABLE_LIVE_LLM === 'true') {
      onProgress?.(`⚡ Calling optional OpenRouter preview (${openRouterConfig.model}); deterministic demo controls service routing...`);
      try {
        await invokeOpenRouterChat([
          { role: 'system', content: `You are Rashid, the Autonomous Smart City Concierge for DubaiNow & TAMM platforms.\n${profileRes.data.promptContext}` },
          { role: 'user', content: prompt },
        ]);
      } catch (err: any) {
        onProgress?.(`⚠️ OpenRouter notice: ${err.message}. Proceeding with deterministic demo routing.`);
      }
    }

    // 4. Cognitive Domain Routing & Microservice Tool Execution
    if (targetDomain === 'composite') {
      if (hasHousingAction) {
        onProgress?.('🏠 Executing Move-In Golden Path: Verifying Ejari, connecting DEWA & issuing residential parking...');
        const ejariRes = executeCatalogRequest('GET', '/housing/ejari');
        const dewaRes = executeFoodRequest('GET', '/utilities/consumption');
        const parkingRes = executeRideRequest('GET', '/mobility/parking/zones');

        state.currentSurface = this.buildMoveInSurface(state.sessionId, ejariRes.data.contract, dewaRes.data.account, profile);
        state.messages.push({
          id: `msg_${Date.now() + 1}`,
          role: 'assistant',
          content: `Prepared a demo move-in proposal for ${ejariRes.data.contract.property.building}. Review and confirm before activating services; no move-in effects have run yet.`,
          timestamp: Date.now(),
        });
      } else if (lower.includes('pizza') && lower.includes('ride')) {
        // Legacy multi-domain fallback for backwards compatibility
        onProgress?.('🔀 Orchestrating composite workflow across Ride, Food, and Wallet microservices...');
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
      } else {
        // Smart City Unified Civic Living Reconciliation across DEWA, Dubai Police, and Salik
        onProgress?.('🏛️ Compiling Unified Civic Living Reconciliation across DEWA, Dubai Police, and Salik...');
        const billRes = executeFoodRequest('GET', '/utilities/bill');
        const finesRes = executeWalletRequest('GET', '/fines/check');
        const salikRes = executeRideRequest('GET', '/mobility/salik/balance');
        const walletRes = executeWalletRequest('GET', '/wallet/balance');

        state.currentSurface = this.buildSmartCityCompositeSurface(state.sessionId, billRes.data.bill, finesRes.data, salikRes.data, walletRes.data, profile);
        state.messages.push({
          id: `msg_${Date.now() + 1}`,
          role: 'assistant',
          content: `I've compiled your unified municipal summary for ${profile.displayName}. Settle your DEWA bill, traffic radar fines, and Salik recharge in one secure DubaiPay checkout.`,
          timestamp: Date.now(),
        });
      }
    } else if (targetDomain === 'ride') {
      if (hasParkingAction || hasSalikAction || hasEVAction || lower.includes('car') || lower.includes('drive')) {
        onProgress?.('🚗 Querying RTA & Mawaqif Smart Mobility for Parking, Salik, and EV Chargers...');
        const zonesRes = executeRideRequest('GET', '/mobility/parking/zones');
        const salikRes = executeRideRequest('GET', '/mobility/salik/balance');
        const evRes = executeRideRequest('GET', '/mobility/ev/chargers');

        onProgress?.(`🅿️ Rendering smart parking zones and highlighting Tesla Model Y (Dubai B-74892)...`);
        state.currentSurface = this.buildParkingSelectionSurface(state.sessionId, zonesRes.data.zones, salikRes.data, evRes.data.chargers, profile);
        state.messages.push({
          id: `msg_${Date.now() + 1}`,
          role: 'assistant',
          content: `Smart Parking is available in Zone 302A Downtown (Burj Khalifa). Salik balance is ${salikRes.data.balance} AED, and DEWA EV Fast Chargers are available nearby.`,
          timestamp: Date.now(),
        });
      } else {
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
      }
    } else if (targetDomain === 'food') {
      if (hasUtilitiesAction || lower.includes('utility') || lower.includes('bill') || lower.includes('meter')) {
        onProgress?.('⚡ Connecting to DEWA / ADDC Smart Grid for Premise DEWA-201948201...');
        const billRes = executeFoodRequest('GET', '/utilities/bill');
        const consumptionRes = executeFoodRequest('GET', '/utilities/consumption');

        onProgress?.('📊 Compiling smart meter consumption and Green Slab tariff advice...');
        state.currentSurface = this.buildUtilitiesSurface(state.sessionId, billRes.data.bill, consumptionRes.data.account, profile);
        state.messages.push({
          id: `msg_${Date.now() + 1}`,
          role: 'assistant',
          content: `Your DEWA utility bill for premise ${billRes.data.bill.premiseId} is ${billRes.data.bill.totalAmount} AED (Status: ${billRes.data.bill.status}). You are in the Green Slab with 142 kg CO2 saved.`,
          timestamp: Date.now(),
        });
      } else {
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
      }
    } else if (targetDomain === 'wallet') {
      if (hasPoliceAction) {
        onProgress?.('👮 Querying Dubai Police & Abu Dhabi Police for vehicle traffic violations...');
        const finesRes = executeWalletRequest('GET', '/fines/check');
        const walletRes = executeWalletRequest('GET', '/wallet/balance');

        onProgress?.('⚡ Applying 10% early settlement discount...');
        state.currentSurface = this.buildPoliceFinesSurface(state.sessionId, finesRes.data, walletRes.data.balance, profile);
        state.messages.push({
          id: `msg_${Date.now() + 1}`,
          role: 'assistant',
          content: `Found ${finesRes.data.count} traffic fines for plate Dubai B-74892 totaling ${finesRes.data.totalPayable} AED (after 10% early settlement discount).`,
          timestamp: Date.now(),
        });
      } else {
        onProgress?.('💳 Querying DubaiPay Citizen Wallet for balances and ledger history...');
        const walletRes = executeWalletRequest('GET', '/wallet/balance');
        const txRes = executeWalletRequest('GET', '/wallet/transactions');

        onProgress?.(`📊 Building secure DubaiPay overview with verified UAE PASS citizen credentials...`);
        state.currentSurface = this.buildWalletOverviewSurface(state.sessionId, walletRes.data.balance, txRes.data.transactions, profile);
        state.messages.push({
          id: `msg_${Date.now() + 1}`,
          role: 'assistant',
          content: `Welcome back, ${profile.displayName}! Your DubaiPay citizen wallet balance is ${walletRes.data.balance} AED with active ${profile.residencyStatus || 'Golden Visa Resident'} status.`,
          timestamp: Date.now(),
        });
      }
    } else if (hasProfileIntent) {
      onProgress?.('🛡️ Retrieving UAE PASS National Identity and citizen credentials...');
      state.currentSurface = this.buildProfileOverviewSurface(state.sessionId, profile, preferences);
      state.messages.push({
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `Here is your UAE PASS verified identity and registered smart city assets, ${profile.displayName}.`,
        timestamp: Date.now(),
      });
    } else {
      // General Concierge welcome / smart city catalog query
      onProgress?.('📦 Fetching registered civic services from Smart City Catalog...');
      const catalogRes = executeCatalogRequest('GET', '/miniapps');

      state.currentSurface = this.buildConciergeCatalogSurface(state.sessionId, catalogRes.data.miniApps, profile);
      state.messages.push({
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `Marhaba ${profile.displayName}! I am Rashid, your Smart City Citizen Concierge (DubaiNow / TAMM). You can ask me to pay DEWA bills, park your car, check traffic fines, or manage your Ejari lease.`,
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
    onProgress?.(`⚡ Processing Smart City action: ${action}...`);

    if (action === 'activate_parking') {
      onProgress?.('🅿️ Activating RTA / Mawaqif Smart Parking meter...');
      const res = executeRideRequest('POST', '/mobility/parking/activate', {}, {
        zoneId: payload.selectedChoice || payload.zoneId || 'zone_302a',
        durationHours: payload.durationHours || 2,
        plateNumber: payload.plateNumber || 'Dubai B-74892',
      });

      const meter = res.data.meter;
      state.currentSurface = {
        version: '1.0.0',
        sessionId: state.sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'parking_active_card',
          style: { variant: 'success', padding: 'medium', direction: 'vertical' },
          children: [
            {
              type: 'Heading',
              id: 'meter_title',
              properties: { text: `🅿️ Parking Meter Active • Zone ${meter.zoneCode}`, level: 2 },
            },
            {
              type: 'Badge',
              id: 'badge_active',
              properties: { text: '🟢 Live Meter Running', variant: 'success' },
            },
            {
              type: 'Text',
              id: 'meter_desc',
              properties: {
                text: `Vehicle: ${meter.plateNumber} (Tesla Model Y EV) • ${meter.zoneName}. Total tariff paid: ${meter.totalFee} AED.`,
              },
            },
            {
              type: 'MetricWidget',
              id: 'meter_countdown',
              properties: { label: 'Time Remaining', value: '1h 59m', trend: 'neutral', subtext: 'Expires at 11:45 AM' },
            },
            {
              type: 'MetricWidget',
              id: 'meter_ticket',
              properties: { label: 'RTA Parking e-Ticket', value: meter.ticketId, subtext: 'Valid for Zone 302A (Downtown)' },
            },
            {
              type: 'Button',
              id: 'btn_extend_parking',
              properties: { label: 'Extend Parking (+1 Hour • 4.00 AED)', variant: 'outline', fullWidth: true },
              onEvents: [
                {
                  event: 'onPress',
                  actionType: 'AGENT_ACTION_DISPATCH',
                  payload: { action: 'extend_parking', ticketId: meter.ticketId },
                },
              ],
            },
          ],
        },
      };
      state.messages.push({
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: `Smart parking meter activated for vehicle ${meter.plateNumber} in Zone ${meter.zoneCode}. e-Ticket: ${meter.ticketId}.`,
        timestamp: Date.now(),
      });
    } else if (action === 'extend_parking') {
      onProgress?.('🅿️ Extending parking meter by 1 hour...');
      executeRideRequest('POST', '/mobility/parking/extend', {}, {
        ticketId: payload.ticketId, additionalHours: 1,
      });

      state.currentSurface = {
        version: '1.0.0',
        sessionId: state.sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'parking_extended_card',
          style: { variant: 'success', padding: 'medium' },
          children: [
            {
              type: 'Heading',
              id: 'ext_title',
              properties: { text: '🅿️ Parking Duration Successfully Extended!', level: 2 },
            },
            {
              type: 'MetricWidget',
              id: 'ext_timer',
              properties: { label: 'Updated Remaining Time', value: '2h 59m', trend: 'up', subtext: '+1 Hour Added' },
            },
          ],
        },
      };
    } else if (action === 'pay_utilities_bill') {
      onProgress?.('⚡ Settling DEWA electricity & water bill via DubaiPay...');
      const res = executeFoodRequest('POST', '/utilities/pay', {}, { billId: executeFoodRequest('GET', '/utilities/bill').data.bill.billId });
      const rcpt = res.data.receipt;

      state.currentSurface = {
        version: '1.0.0',
        sessionId: state.sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'utilities_paid_card',
          style: { variant: 'success', padding: 'medium', direction: 'vertical' },
          children: [
            {
              type: 'Heading',
              id: 'util_paid_title',
              properties: { text: '⚡ DEWA Utility Bill Settled!', level: 2 },
            },
            {
              type: 'Badge',
              id: 'green_badge',
              properties: { text: '🌱 50 Green Energy Points Earned', variant: 'success' },
            },
            {
              type: 'Text',
              id: 'util_paid_text',
              properties: {
                text: `Payment of ${rcpt.amountPaid} confirmed for premise ${rcpt.premiseId}. Receipt Number: ${rcpt.receiptNumber}.`,
              },
            },
            {
              type: 'MetricWidget',
              id: 'new_util_balance',
              properties: { label: 'Outstanding Balance', value: '0.00 AED', trend: 'down', subtext: 'Account in good standing' },
            },
          ],
        },
      };
      state.messages.push({
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: `DEWA bill settled successfully. Receipt ${rcpt.receiptNumber} archived to your digital citizen vault.`,
        timestamp: Date.now(),
      });
    } else if (action === 'pay_police_fines') {
      onProgress?.('👮 Settling traffic radar fines with Dubai Police HQ...');
      const res = executeWalletRequest('POST', '/fines/pay', {}, { fineIds: executeWalletRequest('GET', '/fines/check').data.fines.map((fine: any) => fine.fineId) });

      state.currentSurface = {
        version: '1.0.0',
        sessionId: state.sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'police_fines_settled_card',
          style: { variant: 'success', padding: 'medium', direction: 'vertical' },
          children: [
            {
              type: 'Heading',
              id: 'fines_title',
              properties: { text: '👮 Dubai Police Fines Cleared!', level: 2 },
            },
            {
              type: 'Badge',
              id: 'zero_points',
              properties: { text: '⭐ 0 Black Points Recorded', variant: 'success' },
            },
            {
              type: 'Text',
              id: 'fines_desc',
              properties: {
                text: `${res.data.message} Payment of ${res.data.amountPaid} AED settled. Receipt: ${res.data.receiptNumber}.`,
              },
            },
            {
              type: 'MetricWidget',
              id: 'wallet_rem',
              properties: { label: 'Remaining Wallet Balance', value: `${res.data.remainingBalance} AED`, trend: 'neutral' },
            },
          ],
        },
      };
      state.messages.push({
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: `All traffic fines cleared with Dubai Police. Zero black points on plate Dubai B-74892.`,
        timestamp: Date.now(),
      });
    } else if (action === 'confirm_smartcity_checkout') {
      onProgress?.('🏛️ Executing Unified Civic Living Settlement across DEWA, Police, and Salik...');
      const res = executeWalletRequest('POST', '/pay/unified', {}, { items: [
        { agency: 'DEWA', purpose: 'Demo utility settlement', amount: 420.4 },
        { agency: 'Dubai Police', purpose: 'Demo fine settlement', amount: 420 },
        { agency: 'RTA Salik', purpose: 'Demo toll recharge', amount: 100 },
      ] });
      executeFoodRequest('POST', '/utilities/pay', {}, { billId: executeFoodRequest('GET', '/utilities/bill').data.bill.billId });
      const remainingFineIds = executeWalletRequest('GET', '/fines/check').data.fines.map((fine: any) => fine.fineId);
      if (remainingFineIds.length) executeWalletRequest('POST', '/fines/pay', {}, { fineIds: remainingFineIds });
      executeRideRequest('POST', '/mobility/salik/recharge', {}, { amount: 100 });

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
              id: 'gov_checkout_title',
              properties: { text: '🏛️ Unified Smart City Living Reconciliation Complete!', level: 2 },
            },
            {
              type: 'Badge',
              id: 'hash_badge',
              properties: { text: `Transaction Hash: ${res.data.govTransactionHash}`, variant: 'success' },
            },
            {
              type: 'Text',
              id: 'gov_checkout_desc',
              properties: {
                text: `Total payment of ${res.data.grandTotal} AED processed via ${res.data.settlementPlatform}. All agency accounts reconciled.`,
              },
            },
            {
              type: 'MetricWidget',
              id: 'metric_dewa_status',
              properties: { label: 'DEWA Utilities', value: 'Paid in Full (420.40 AED)', trend: 'up' },
            },
            {
              type: 'MetricWidget',
              id: 'metric_police_status',
              properties: { label: 'Dubai Police Fines', value: 'Cleared (420.00 AED)', trend: 'up' },
            },
            {
              type: 'MetricWidget',
              id: 'metric_salik_status',
              properties: { label: 'Salik Toll Tag', value: 'Recharged (+100.00 AED)', trend: 'up' },
            },
          ],
        },
      };
      state.messages.push({
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: `Unified municipal settlement completed via DubaiPay. DEWA, Dubai Police, and Salik balances are now up to date.`,
        timestamp: Date.now(),
      });
    } else if (action === 'confirm_movein') {
      onProgress?.('🏠 Finalizing Move-In Golden Path with Dubai Land Department...');
      const res = executeCatalogRequest('POST', '/housing/move-in', {}, { contractNumber: executeCatalogRequest('GET', '/housing/ejari').data.contract.contractNumber });
      executeRideRequest('POST', '/mobility/parking/activate', {}, { zoneId: 'zone_302a', durationHours: 720, plateNumber: 'Dubai B-74892' });

      state.currentSurface = {
        version: '1.0.0',
        sessionId: state.sessionId,
        timestamp: Date.now(),
        view: {
          type: 'SurfaceCard',
          id: 'movein_confirmed_card',
          style: { variant: 'success', padding: 'medium', direction: 'vertical' },
          children: [
            {
              type: 'Heading',
              id: 'movein_title',
              properties: { text: '🎉 Home Onboarding Complete!', level: 2 },
            },
            {
              type: 'Badge',
              id: 'badge_ejari_active',
              properties: { text: `Ejari: ${res.data.ejariContract}`, variant: 'success' },
            },
            {
              type: 'Text',
              id: 'movein_desc',
              properties: {
                text: `Welcome to ${res.data.unit}! DEWA electricity & water is connected with security deposit waived. RTA Residential Parking permit ${res.data.residentialParking.permitNumber} is active.`,
              },
            },
            {
              type: 'MetricWidget',
              id: 'dewa_meter',
              properties: { label: 'DEWA Smart Meter', value: 'ACTIVE (Deposit Waived)', trend: 'up' },
            },
            {
              type: 'MetricWidget',
              id: 'rta_permit',
              properties: { label: 'RTA Parking Permit', value: 'Zone 302A Residential', trend: 'up' },
            },
          ],
        },
      };
      state.messages.push({
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: `Home onboarding complete for ${res.data.unit}. DEWA smart meter connected and residential parking issued.`,
        timestamp: Date.now(),
      });
    } else if (action === 'book_ride') {
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
      executeFoodRequest('POST', '/orders/create', {}, { restaurantId: 'rest_1', items: ['item_diavola'] });

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
      const { action: _action, ...preferences } = payload;
      const updateRes = executeProfileRequest('POST', '/profile/preferences', {}, preferences);
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
            properties: { text: `💳 DubaiPay Citizen Wallet • ${profile?.displayName || 'Active Citizen'}`, level: 2 },
          },
          {
            type: 'Badge',
            id: 'vip_badge',
            properties: {
              text: `🛡️ UAE PASS Verified • ${profile?.vipTier || 'Gold VIP'} Member • ${profile?.residencyStatus || 'Golden Visa Resident'} • Zero Surcharge`,
              variant: 'success',
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_balance',
            properties: { label: 'Active DubaiPay Balance', value: `${balance.toFixed(2)} AED`, trend: 'neutral' },
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
                amount: `${t.type === 'PAYMENT' ? '-' : '+'}${t.amount.toFixed(2)} AED`,
              })),
            },
          },
          {
            type: 'Button',
            id: 'btn_topup_50',
            properties: { label: 'Quick Top-Up (+50.00 AED via DubaiPay)', variant: 'outline', fullWidth: true },
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
    const vehicle = profile.smartCityAssets?.vehicles[0]?.plate || 'Dubai B-74892';
    const premise = profile.smartCityAssets?.premises[0]?.premiseId || 'DEWA-201948201';

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
            properties: { text: `🛡️ UAE PASS Citizen Profile: ${profile.displayName}`, level: 2 },
          },
          {
            type: 'Badge',
            id: 'prof_vip',
            properties: { text: `👑 ${profile.residencyStatus || 'Golden Visa Resident'} • ${profile.vipTier}`, variant: 'success' },
          },
          {
            type: 'MetricWidget',
            id: 'metric_eid',
            properties: {
              label: 'Emirates ID (UAE PASS Verified)',
              value: profile.emiratesId || '784-1988-1234567-1',
              subtext: 'Cryptographically Verified Citizen',
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_vehicle',
            properties: {
              label: 'Registered Smart Vehicle',
              value: vehicle,
              subtext: `Tesla Model Y EV • Salik Tag SLK-8492019`,
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_premise',
            properties: {
              label: 'Registered Home Premise',
              value: premise,
              subtext: 'Downtown Dubai, Unit 1402 • Ejari EJR-2026-948102',
            },
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

  // --------------------------------------------------------------------------
  // Smart City AG-UI Surface Builders (DubaiNow & TAMM Civic Journeys)
  // --------------------------------------------------------------------------

  private static buildParkingSelectionSurface(
    sessionId: string,
    zones: any[],
    salik: any,
    evChargers: any[],
    profile?: UserProfile
  ): AGUISurfacePayload {
    const defaultZone = zones[0]?.id || 'zone_302a';
    const plate = profile?.smartCityAssets?.vehicles[0]?.plate || 'Dubai B-74892';
    const carModel = profile?.smartCityAssets?.vehicles[0]?.model || 'Tesla Model Y (EV)';

    const options = zones.map((z: any) => {
      const rate = z.tariffPerHour || z.hourlyRate || 4.0;
      return {
        id: z.id,
        title: `${z.name} (${z.code})`,
        subtitle: `${z.city || 'Dubai'} • Rate: ${rate.toFixed(2)} AED/hr • Available: ${z.availableSpots}/${z.totalCapacity || 100}`,
        price: `${rate.toFixed(2)} AED/hr`,
        badge: z.id === 'zone_302a' ? '⭐ Preferred Zone' : 'Available',
      };
    });

    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'parking_selection_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'parking_heading',
            properties: { text: `🅿️ RTA & Mawaqif Smart Parking • ${profile?.displayName || 'Citizen'}`, level: 2 },
          },
          {
            type: 'Badge',
            id: 'parking_badge',
            properties: { text: `🚗 Registered EV: ${plate} (${carModel})`, variant: 'success' },
          },
          {
            type: 'MapViewer',
            id: 'parking_map',
            properties: {
              center: { lat: 25.1972, lng: 55.2744 },
              zoom: 14,
              markers: [
                ...zones.map((z: any) => ({
                  id: z.id,
                  lat: z.lat,
                  lng: z.lng,
                  title: `${z.name} (${z.code})`,
                })),
                ...evChargers.map((c: any) => ({
                  id: c.id,
                  lat: c.lat,
                  lng: c.lng,
                  title: `⚡ DEWA EV Charger: ${c.name} (${c.power})`,
                })),
              ],
            },
          },
          {
            type: 'MetricWidget',
            id: 'salik_balance_widget',
            properties: {
              label: 'Salik Toll Tag Balance',
              value: `${salik.balance.toFixed(2)} AED`,
              subtext: `Tag: ${salik.tagNumber} (${salik.status}) • Darb Compatible`,
              trend: 'neutral',
            },
          },
          {
            type: 'ChoiceGroup',
            id: 'parking_zones_choice',
            properties: {
              selectedId: defaultZone,
              options,
            },
          },
          {
            type: 'Button',
            id: 'btn_activate_parking',
            properties: { label: '🅿️ Activate Smart Parking Meter (2 Hours • 8.00 AED)', variant: 'primary', fullWidth: true },
            onEvents: [
              {
                event: 'onPress',
                actionType: 'AGENT_ACTION_DISPATCH',
                payload: { action: 'activate_parking', zoneId: defaultZone, durationHours: 2, plateNumber: plate },
              },
            ],
          },
        ],
      },
    };
  }

  private static buildUtilitiesSurface(
    sessionId: string,
    bill: any,
    account: any,
    profile?: UserProfile
  ): AGUISurfacePayload {
    const slab = account?.telemetry?.tariffSlab || account?.electricity?.slabTariff || 'Green Slab (<=2000 kWh/mo)';
    const co2 = account?.telemetry?.carbonSavedKg ?? account?.carbonOffsetKg ?? 142.0;
    const elecKwh = account?.telemetry?.electricityKwh ?? account?.electricity?.currentKWh ?? 480;
    const waterGal = account?.telemetry?.waterGallons ?? account?.water?.currentGallons ?? 1200;
    const elecCost = bill?.breakdown?.electricity ?? bill?.electricityCost ?? 110.4;
    const waterCost = bill?.breakdown?.water ?? bill?.waterCost ?? 42.0;
    const sewCost = bill?.breakdown?.sewerage ?? bill?.sewerageFee ?? 28.0;
    const houseCost = bill?.breakdown?.housingFee ?? bill?.housingFee ?? 240.0;

    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'utilities_overview_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'util_title',
            properties: { text: `⚡ DEWA Smart Utilities • Premise ${bill.premiseId}`, level: 2 },
          },
          {
            type: 'Badge',
            id: 'eco_badge',
            properties: {
              text: `🌱 ${slab} Active • ${co2} kg CO2 Offset`,
              variant: 'success',
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_elec',
            properties: {
              label: 'Smart Meter Electricity',
              value: `${elecKwh} kWh`,
              subtext: 'Green Slab Tariff (Low Emission)',
              trend: 'down',
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_water',
            properties: {
              label: 'Smart Meter Water',
              value: `${waterGal} Gallons`,
              subtext: 'High-Efficiency Flow',
              trend: 'neutral',
            },
          },
          {
            type: 'DataTable',
            id: 'bill_breakdown_table',
            properties: {
              columns: [
                { key: 'category', title: 'Utility Component' },
                { key: 'amount', title: 'Amount (AED)' },
              ],
              rows: [
                { category: 'Electricity (DEWA Smart Grid)', amount: `${elecCost.toFixed(2)} AED` },
                { category: 'Water (Desalination Grid)', amount: `${waterCost.toFixed(2)} AED` },
                { category: 'Sewerage & Environmental Fee', amount: `${sewCost.toFixed(2)} AED` },
                { category: 'Dubai Municipality Housing Fee (5%)', amount: `${houseCost.toFixed(2)} AED` },
              ],
            },
          },
          {
            type: 'ChoiceGroup',
            id: 'dewa_payment_channel_choice',
            properties: {
              selectedId: 'opt_dubaipay',
              options: [
                {
                  id: 'opt_dubaipay',
                  title: 'DubaiPay Direct Debit (Emirates NBD)',
                  subtitle: 'Instant settlement • 0.00 AED surcharge • Green Slab certified',
                  price: `${bill.totalAmount.toFixed(2)} AED`,
                  badge: '⭐ Recommended',
                },
                {
                  id: 'opt_applepay',
                  title: 'Apple Pay / Digital Card',
                  subtitle: 'Instant biometric settlement',
                  price: `${bill.totalAmount.toFixed(2)} AED`,
                },
                {
                  id: 'opt_autopay',
                  title: 'Green Slab Smart Autopay',
                  subtitle: 'Automated recurring billing on the 1st of every month',
                  price: 'Auto-Debit',
                },
              ],
            },
          },
          {
            type: 'Button',
            id: 'btn_pay_dewa',
            properties: {
              label: `💳 Settle DEWA Bill via DubaiPay (${bill.totalAmount.toFixed(2)} AED)`,
              variant: 'primary',
              fullWidth: true,
            },
            onEvents: [
              {
                event: 'onPress',
                actionType: 'AGENT_ACTION_DISPATCH',
                payload: { action: 'pay_utilities_bill' },
              },
            ],
          },
        ],
      },
    };
  }

  private static buildPoliceFinesSurface(
    sessionId: string,
    finesData: any,
    walletBalance: number,
    profile?: UserProfile
  ): AGUISurfacePayload {
    const discount = finesData.earlyDiscountAED ?? finesData.discountApplied ?? 46.0;

    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'police_fines_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'fines_heading',
            properties: { text: `👮 Dubai Police Traffic Fines • Plate ${finesData.plateNumber}`, level: 2 },
          },
          {
            type: 'Badge',
            id: 'fines_discount_badge',
            properties: {
              text: `✨ 10% Early Settlement Discount Applied (-${discount.toFixed(2)} AED)`,
              variant: 'success',
            },
          },
          {
            type: 'MetricWidget',
            id: 'fines_total_metric',
            properties: {
              label: 'Total Payable to Dubai Police',
              value: `${finesData.totalPayable.toFixed(2)} AED`,
              subtext: `${finesData.count} Pending Radar Violations • 0 Black Points`,
              trend: 'neutral',
            },
          },
          {
            type: 'DataTable',
            id: 'violations_table',
            properties: {
              columns: [
                { key: 'violation', title: 'Violation' },
                { key: 'location', title: 'Location' },
                { key: 'amount', title: 'Payable' },
              ],
              rows: finesData.fines.map((f: any) => ({
                violation: f.violation,
                location: f.location,
                amount: `${f.payableAmount.toFixed(2)} AED`,
              })),
            },
          },
          {
            type: 'Button',
            id: 'btn_settle_fines',
            properties: {
              label: `🛡️ Settle Fines via DubaiPay (${finesData.totalPayable.toFixed(2)} AED)`,
              variant: 'primary',
              fullWidth: true,
            },
            onEvents: [
              {
                event: 'onPress',
                actionType: 'AGENT_ACTION_DISPATCH',
                payload: { action: 'pay_police_fines' },
              },
            ],
          },
        ],
      },
    };
  }

  private static buildSmartCityCompositeSurface(
    sessionId: string,
    bill: any,
    finesData: any,
    salikData: any,
    walletData: any,
    profile?: UserProfile
  ): AGUISurfacePayload {
    const salikTopup = 100.0;
    const grandTotal = Math.round((bill.totalAmount + finesData.totalPayable + salikTopup) * 100) / 100;

    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'smartcity_composite_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'composite_gov_heading',
            properties: { text: `🏛️ SmartCity Unified Civic Living Settlement`, level: 2 },
          },
          {
            type: 'Badge',
            id: 'uae_pass_badge',
            properties: {
              text: `🛡️ UAE PASS Verified • ${profile?.displayName || 'Citizen'} (${profile?.residencyStatus || 'Golden Visa Resident'})`,
              variant: 'success',
            },
          },
          {
            type: 'Text',
            id: 'composite_intro',
            properties: {
              text: 'Consolidated civic reconciliation across DEWA utilities, Dubai Police fines, and Salik toll account with unified DubaiPay / TAMM Pay checkout:',
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_comp_dewa',
            properties: {
              label: `1. DEWA Utility Bill (Premise ${bill.premiseId})`,
              value: `${bill.totalAmount.toFixed(2)} AED`,
              subtext: 'Green Slab Tariff (Electricity & Water)',
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_comp_police',
            properties: {
              label: `2. Dubai Police Fines (Plate ${finesData.plateNumber})`,
              value: `${finesData.totalPayable.toFixed(2)} AED`,
              subtext: `${finesData.count} violations cleared with 10% early discount`,
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_comp_salik',
            properties: {
              label: `3. Salik Toll Tag Instant Recharge`,
              value: `${salikTopup.toFixed(2)} AED`,
              subtext: `Current Tag Balance: ${salikData.balance.toFixed(2)} AED`,
            },
          },
          {
            type: 'MetricWidget',
            id: 'metric_comp_total',
            properties: {
              label: 'Grand Total Payable (Unified DubaiPay Settlement)',
              value: `${grandTotal.toFixed(2)} AED`,
              trend: 'neutral',
            },
          },
          {
            type: 'Button',
            id: 'btn_confirm_smartcity_checkout',
            properties: {
              label: `🏛️ Authorize Unified DubaiPay Settlement (${grandTotal.toFixed(2)} AED)`,
              variant: 'primary',
              fullWidth: true,
            },
            onEvents: [
              {
                event: 'onPress',
                actionType: 'AGENT_ACTION_DISPATCH',
                payload: { action: 'confirm_smartcity_checkout' },
              },
            ],
          },
        ],
      },
    };
  }

  private static buildMoveInSurface(
    sessionId: string,
    contract: any,
    account: any,
    profile?: UserProfile
  ): AGUISurfacePayload {
    const rent = contract.annualRentAED ?? contract.annualRent ?? 96000;

    return {
      version: '1.0.0',
      sessionId,
      timestamp: Date.now(),
      view: {
        type: 'SurfaceCard',
        id: 'movein_card',
        style: { padding: 'medium', direction: 'vertical' },
        children: [
          {
            type: 'Heading',
            id: 'movein_heading',
            properties: { text: `🏠 Move-In Plan — Awaiting Confirmation • Unit ${contract.property.unitNumber}`, level: 2 },
          },
          {
            type: 'Badge',
            id: 'ejari_badge',
            properties: {
              text: `📜 Registered Ejari: ${contract.contractNumber}`,
              variant: 'success',
            },
          },
          {
            type: 'Text',
            id: 'movein_desc',
            properties: {
              text: `Proposed demo tenancy activation for ${contract.tenantName} at ${contract.property.building}, ${contract.property.community}:`,
            },
          },
          {
            type: 'MetricWidget',
            id: 'lease_period_metric',
            properties: {
              label: 'Tenancy Contract Validity',
              value: `${contract.startDate} to ${contract.endDate}`,
              subtext: `Annual Rent: ${rent.toLocaleString()} AED`,
            },
          },
          {
            type: 'MetricWidget',
            id: 'dewa_connection_metric',
            properties: {
              label: 'DEWA Smart Meter Activation',
              value: 'Pending approval',
              subtext: `Premise ${contract.property.premiseId} • Demo deposit-waiver proposal`,
              trend: 'up',
            },
          },
          {
            type: 'MetricWidget',
            id: 'rta_permit_metric',
            properties: {
              label: 'RTA Residential Parking Permit',
              value: 'Pending approval',
              subtext: 'Proposed Zone 302A residential parking',
              trend: 'up',
            },
          },
          {
            type: 'Button',
            id: 'btn_confirm_movein',
            properties: {
              label: '🎉 Activate Smart Meter & Move-In Golden Path',
              variant: 'primary',
              fullWidth: true,
            },
            onEvents: [
              {
                event: 'onPress',
                actionType: 'AGENT_ACTION_DISPATCH',
                payload: { action: 'confirm_movein' },
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
            properties: { text: `🌟 SmartCity Now • Unified Citizen Portal (${profile?.displayName || 'Citizen'})`, level: 2 },
          },
          {
            type: 'Badge',
            id: 'civic_badge',
            properties: { text: `🛡️ Powered by DubaiNow & TAMM Architecture`, variant: 'success' },
          },
          {
            type: 'Text',
            id: 'cat_desc',
            properties: {
              text: 'Autonomous civic concierge powered by UAE PASS digital identity. Ask in natural language or tap any municipal service:',
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

