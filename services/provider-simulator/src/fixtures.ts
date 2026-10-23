import { readFileSync } from 'node:fs';
/** Provider-owned synthetic seed data; no application handler is imported. */
const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
export const parkingZones: Array<any> = fixtures.parkingZones;
export const evChargerStations: Array<any> = fixtures.evChargerStations;
export const drivers: Array<any> = fixtures.drivers;
export const defaultUtilityAccount = fixtures.defaultUtilityAccount;
export const activeUtilityBill = fixtures.activeUtilityBill;
export const defaultEjariContract = fixtures.defaultEjariContract;
