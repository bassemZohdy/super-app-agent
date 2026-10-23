/** Bundled demo routes: no remote scripts, models, or client-selected handlers. */
export const manualServices = [
  { id: 'parking', name: 'Parking', prompt: 'Show parking zones' },
  { id: 'salik', name: 'Salik', prompt: 'Check Salik balance' },
  { id: 'utilities', name: 'Utilities', prompt: 'Check DEWA electricity and water bill' },
  { id: 'fines', name: 'Traffic fines', prompt: 'Check police traffic fines' },
  { id: 'wallet', name: 'Wallet', prompt: 'Show wallet balance' },
  { id: 'housing', name: 'Housing', prompt: 'Help me move in to my Ejari tenancy' },
  { id: 'etisalat', name: 'Etisalat', prompt: 'Show Etisalat subscriptions and bills' },
  { id: 'du', name: 'du', prompt: 'Show du subscriptions and bills' },
  { id: 'ride', name: 'Ride', prompt: 'Find a cab ride' },
  { id: 'food', name: 'Dining', prompt: 'Show pizza restaurants' },
  { id: 'profile', name: 'My profile', prompt: 'Show my citizen profile and preferences' },
] as const;
export function manualService(id: string) { return manualServices.find(service => service.id === id); }
