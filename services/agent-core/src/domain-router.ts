import type { DomainCategory } from './langgraph/state.ts';

/**
 * Deterministic domain routing for a citizen utterance.
 *
 * Terms match whole words (with common inflections), so a keyword such as `car`
 * does not route "card" requests to mobility, and `eat` does not route "weather".
 * Order of precedence matches the original router: telecom, explicit composite
 * journeys, mobility, food, wallet, then concierge.
 */

const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the lower-cased text contains the term as a whole word or inflected word form. */
export function hasTerm(lower: string, term: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${escape(term)}(?:s|es|ed|ing|er|ers|ment|ments|able)?(?=$|[^a-z0-9])`).test(lower);
}

const any = (lower: string, terms: string[]) => terms.some(term => hasTerm(lower, term));

/** Routing decision plus the action signals the dispatcher reuses. `text` is the routing prompt, including any contextual turns. */
export function analyzeIntent(text: string) {
  const lower = text.toLowerCase();

  // Smart Mobility Intent (RTA / Mawaqif Parking, Salik / Darb Toll, DEWA EV Chargers, Ride)
  const hasParkingAction = any(lower, ['parking', 'park', 'meter', 'zone']);
  const hasSalikAction = any(lower, ['salik', 'darb', 'toll']);
  const hasEVAction = any(lower, ['ev', 'charger', 'charging']);
  const hasRideAction = hasParkingAction || hasSalikAction || hasEVAction || any(lower, ['ride', 'cab', 'taxi', 'car', 'drive']);

  // Smart Utilities Intent (DEWA / ADDC Electricity & Water, Smart Meters, Bills)
  const hasUtilitiesAction = any(lower, ['dewa', 'addc', 'electricity', 'water', 'utility', 'utilities', 'consumption', 'power']);
  const hasFoodAction = hasUtilitiesAction || any(lower, ['food', 'restaurant', 'lunch', 'dinner', 'pizza', 'order', 'reorder', 'menu', 'dining', 'eat']);

  // Citizen Pay & Police Fines Intent (Dubai Police, Abu Dhabi Police, Traffic Violations, Wallet)
  const hasPoliceAction = any(lower, ['fine', 'police', 'radar', 'speeding', 'violation']);
  const hasWalletAction = hasPoliceAction || any(lower, ['pay', 'wallet', 'balance', 'topup', 'top up', 'ledger', 'dubaipay', 'tamm']);

  // Housing & Tenancy Move-In Golden Path (Ejari / Tawtheeq)
  const hasHousingAction = any(lower, ['ejari', 'tawtheeq', 'move-in', 'move in', 'tenancy', 'lease']);

  // Multi-Agency Composite Journeys
  const isExplicitComposite = hasHousingAction ||
    (hasUtilitiesAction && (hasPoliceAction || hasWalletAction || hasSalikAction)) ||
    ((hasRideAction || hasParkingAction) && (hasFoodAction || hasUtilitiesAction) && any(lower, ['and', 'both', 'with'])) ||
    (any(lower, ['both']) && (hasRideAction || hasFoodAction));

  const domain: DomainCategory = /\b(etisalat|du|telecom|internet|broadband|mobile plan)\b/i.test(lower) ? 'telecom'
    : isExplicitComposite ? 'composite'
    : hasRideAction ? 'ride'
    : hasFoodAction ? 'food'
    : hasWalletAction ? 'wallet'
    : 'concierge';
  return { domain, hasParkingAction, hasSalikAction, hasEVAction, hasUtilitiesAction, hasPoliceAction, hasHousingAction };
}

export function classifyDomain(text: string): DomainCategory {
  return analyzeIntent(text).domain;
}
