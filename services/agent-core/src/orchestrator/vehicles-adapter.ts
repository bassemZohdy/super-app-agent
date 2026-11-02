import { z } from 'zod/v4';
import { RenewalQuote, RenewalReceipt, Vehicle, type Tool } from './contracts.ts';
import { simulatorRequest } from './simulator-client.ts';

/** The reasons a renewal may be refused with 409; any other conflict remains unconfirmed. */
const REASONS = ['FINES_OUTSTANDING', 'QUOTE_STALE'] as const;
const VehicleList = z.array(Vehicle).max(20).refine(vehicles => new Set(vehicles.map(vehicle => vehicle.id)).size === vehicles.length, 'Vehicle IDs must be unique');

export class VehiclesAdapter {
  readonly list: Tool<Record<string, never>, Vehicle[]>;
  readonly renew: Tool<{ quote: RenewalQuote; consentId: string }, RenewalReceipt>;
  constructor(base: URL, workloadKey: string, timeoutMs = 3000) {
    this.list = { id: 'vehicles.list', description: 'Retrieve this resident’s vehicles that are due for a simulated registration renewal', protocol: 'rest', input: z.object({}).strict(), output: VehicleList, permission: 'vehicles:read', consequential: false, timeoutMs,
      invoke: async (_input, ctx, signal) => VehicleList.parse(await simulatorRequest(base, workloadKey, 'simulator/v1/vehicles', ctx, signal)) };
    this.renew = { id: 'vehicles.renew', description: 'Renew an exact reviewed simulated vehicle registration after confirmation', protocol: 'rest', input: z.object({ quote: RenewalQuote, consentId: z.string().uuid() }).strict(), output: RenewalReceipt, permission: 'vehicles:renew', consequential: true, timeoutMs,
      invoke: async (input, ctx, signal, key) => RenewalReceipt.parse(await simulatorRequest(base, workloadKey, 'simulator/v1/renewals', ctx, signal, { body: input, key, reasons: REASONS })) };
  }
}
