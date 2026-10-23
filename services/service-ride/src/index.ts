import { validateRequest, toolSchema, invalidInput, toMinor, fromMinor, MAX_MONEY, MAX_DURATION_HOURS } from '../../../packages/protocol-core/src/request-validation.ts';
import http from 'node:http';

export interface Driver {
  id: string;
  name: string;
  rating: number;
  car: string;
  etaMinutes: number;
  fare: number;
  lat: number;
  lng: number;
}

export const drivers: Driver[] = [
  {
    id: 'drv_1',
    name: 'Alex M.',
    rating: 4.9,
    car: 'Toyota Camry (Silver)',
    etaMinutes: 4,
    fare: 22.0,
    lat: 37.7749,
    lng: -122.4194,
  },
  {
    id: 'drv_2',
    name: 'Sara K.',
    rating: 4.8,
    car: 'Hyundai Sonata (White)',
    etaMinutes: 7,
    fare: 18.5,
    lat: 37.7785,
    lng: -122.4150,
  },
  {
    id: 'drv_3',
    name: 'Marcus Chen',
    rating: 4.95,
    car: 'Tesla Model Y (Midnight Blue)',
    etaMinutes: 3,
    fare: 28.0,
    lat: 37.7720,
    lng: -122.4210,
  },
];

export interface RideBooking {
  bookingId: string;
  driver: Driver;
  status: 'REQUESTED' | 'DISPATCHED' | 'IN_TRANSIT' | 'COMPLETED';
  pickup: string;
  dropoff: string;
  fare: number;
  etaMinutes: number;
  createdAt: number;
}

export const activeRides = new Map<string, RideBooking>();

// -----------------------------------------------------------------------------
// Smart City Mobility Models: Smart Parking (RTA/Mawaqif), Salik & EV Chargers
// -----------------------------------------------------------------------------
export interface ParkingZone {
  id: string;
  name: string;
  code: string;
  tariffPerHour: number;
  hourlyRate?: number;
  availableSpots: number;
  occupancy: string;
  lat: number;
  lng: number;
}

export const parkingZones: ParkingZone[] = [
  {
    id: 'zone_302a',
    name: 'Downtown Commercial (Burj Khalifa / Dubai Mall)',
    code: '302A',
    tariffPerHour: 4.0,
    hourlyRate: 4.0,
    availableSpots: 42,
    occupancy: '68%',
    lat: 25.1972,
    lng: 55.2744,
  },
  {
    id: 'zone_101b',
    name: 'Business Bay Waterfront (Executive Towers)',
    code: '101B',
    tariffPerHour: 3.0,
    hourlyRate: 3.0,
    availableSpots: 85,
    occupancy: '42%',
    lat: 25.1850,
    lng: 55.2650,
  },
  {
    id: 'zone_204c',
    name: 'Dubai Marina Promenade',
    code: '204C',
    tariffPerHour: 4.0,
    hourlyRate: 4.0,
    availableSpots: 15,
    occupancy: '85%',
    lat: 25.0805,
    lng: 55.1403,
  },
];

export interface ParkingMeterSession {
  ticketId: string;
  zoneId: string;
  zoneName: string;
  zoneCode: string;
  plateNumber: string;
  durationHours: number;
  totalFee: number;
  status: 'ACTIVE' | 'EXPIRED';
  expiresAt: number;
  createdAt: number;
}

export const activeParkingMeters = new Map<string, ParkingMeterSession>();
export let salikBalance = 14.0; // Low balance alert triggered if < 20 AED

export interface EVChargerStation {
  id: string;
  name: string;
  operator: 'DEWA Green Charger' | 'ADDC EV Hub' | 'RTA Express';
  plugTypes: string[];
  powerKW: number;
  status: 'AVAILABLE' | 'OCCUPIED';
  pricePerKWh: number;
  lat: number;
  lng: number;
}

export const evChargerStations: EVChargerStation[] = [
  {
    id: 'chg_1',
    name: 'DEWA Green Charger - Dubai Mall P3',
    operator: 'DEWA Green Charger',
    plugTypes: ['CCS2 Combo (DC)', 'Type 2 Mennekes (AC)'],
    powerKW: 50,
    status: 'AVAILABLE',
    pricePerKWh: 0.29,
    lat: 25.1975,
    lng: 55.2750,
  },
  {
    id: 'chg_2',
    name: 'RTA City Walk Ultra-Fast Hub',
    operator: 'RTA Express',
    plugTypes: ['CCS2 Combo (DC)', 'CHAdeMO'],
    powerKW: 150,
    status: 'AVAILABLE',
    pricePerKWh: 0.35,
    lat: 25.2085,
    lng: 55.2620,
  },
  {
    id: 'chg_3',
    name: 'DIFC Gate Avenue EV Station',
    operator: 'DEWA Green Charger',
    plugTypes: ['Type 2 Mennekes (AC)'],
    powerKW: 22,
    status: 'AVAILABLE',
    pricePerKWh: 0.29,
    lat: 25.2160,
    lng: 55.2810,
  },
];

function handleRideRequest(
  method: string,
  pathname: string,
  query: Record<string, string> = {},
  body: any = {}
): { status: number; data: any } {
  const normMethod = method.toUpperCase();

  // 1. Healthcheck
  if (normMethod === 'GET' && pathname === '/health') {
    return {
      status: 200,
      data: {
        status: 'ok',
        service: 'service-mobility',
        domain: 'Smart Mobility & Transport (RTA/Salik/EV)',
        port: 4001,
        activeParkingMeters: activeParkingMeters.size,
        salikBalance,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Smart Parking Endpoints (RTA Dubai / Mawaqif Abu Dhabi)
  // ---------------------------------------------------------------------------
  if (normMethod === 'GET' && (pathname === '/mobility/parking/zones' || pathname === '/parking/zones')) {
    return {
      status: 200,
      data: {
        success: true,
        count: parkingZones.length,
        zones: parkingZones,
      },
    };
  }

  if (normMethod === 'POST' && (pathname === '/mobility/parking/activate' || pathname === '/parking/activate')) {
    const zoneId = body.zoneId;
    const zone = parkingZones.find(z => z.id === zoneId);
    if (!zone) return { status: 404, data: { error: 'Parking zone not found' } };
    const durationHours = body.durationHours;
    const plateNumber = body.plateNumber;
    const ticketId = `TKT-DXB-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const totalFee = fromMinor(toMinor(zone.tariffPerHour) * durationHours);

    const meter: ParkingMeterSession = {
      ticketId,
      zoneId: zone.id,
      zoneName: zone.name,
      zoneCode: zone.code,
      plateNumber,
      durationHours,
      totalFee,
      status: 'ACTIVE',
      expiresAt: Date.now() + durationHours * 3600 * 1000,
      createdAt: Date.now(),
    };

    activeParkingMeters.set(ticketId, meter);
    return {
      status: 200,
      data: {
        success: true,
        message: `Smart Parking meter activated for ${plateNumber} in Zone ${zone.code}`,
        meter,
      },
    };
  }

  if (normMethod === 'POST' && (pathname === '/mobility/parking/extend' || pathname === '/parking/extend')) {
    const ticketId = body.ticketId;
    const meter = activeParkingMeters.get(ticketId);
    const additionalHours = body.additionalHours;

    if (meter) {
      if (meter.durationHours + additionalHours > MAX_DURATION_HOURS) return invalidInput('Parking duration exceeds demo limit');
      const zone = parkingZones.find(zone => zone.id === meter.zoneId)!;
      const nextFee = toMinor(meter.totalFee) + toMinor(zone.tariffPerHour) * additionalHours;
      if (nextFee > MAX_MONEY * 100) return invalidInput('Parking fee exceeds demo limit');
      meter.durationHours += additionalHours;
      meter.totalFee = fromMinor(nextFee);
      meter.expiresAt += additionalHours * 3600 * 1000;
      return {
        status: 200,
        data: {
          success: true,
          message: `Parking extended by ${additionalHours} hour(s)`,
          meter,
        },
      };
    }
    return { status: 404, data: { error: 'No active parking meter found to extend' } };
  }

  if (normMethod === 'GET' && (pathname === '/mobility/parking/active' || pathname === '/parking/active')) {
    const active = Array.from(activeParkingMeters.values())[0] || {
      ticketId: 'PRK-2026-98124',
      zoneId: 'zone_302a',
      zoneName: 'Downtown Commercial (Burj Khalifa / Dubai Mall)',
      zoneCode: '302A',
      plateNumber: 'Dubai B-74892',
      durationHours: 2,
      totalFee: 8.0,
      status: 'ACTIVE',
      expiresAt: Date.now() + 7140 * 1000, // ~1 hr 59 mins
      createdAt: Date.now() - 60 * 1000,
    };
    return {
      status: 200,
      data: {
        success: true,
        meter: active,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Salik & Darb Toll Roads Endpoints
  // ---------------------------------------------------------------------------
  if (normMethod === 'GET' && (pathname === '/mobility/salik/balance' || pathname === '/salik/balance')) {
    return {
      status: 200,
      data: {
        success: true,
        tagId: 'SLK-8492019',
        tagNumber: 'SLK-8492019',
        accountNumber: 'ACC-DXB-948190',
        plateNumber: 'Dubai B-74892',
        balance: salikBalance,
        currency: 'AED',
        lowBalanceAlert: salikBalance < 20.0,
        status: 'ACTIVE',
      },
    };
  }

  if (normMethod === 'POST' && (pathname === '/mobility/salik/recharge' || pathname === '/salik/recharge')) {
    const amount = body.amount;
    const nextBalance = toMinor(salikBalance) + toMinor(amount);
    if (nextBalance > MAX_MONEY * 100) return invalidInput('Toll balance exceeds demo limit');
    salikBalance = fromMinor(nextBalance);
    return {
      status: 200,
      data: {
        success: true,
        rechargedAmount: amount,
        newBalance: salikBalance,
        tagId: 'SLK-8492019',
        transactionId: `SLK-TX-${Date.now()}`,
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (normMethod === 'GET' && (pathname === '/mobility/salik/passings' || pathname === '/salik/passings')) {
    return {
      status: 200,
      data: {
        success: true,
        tagId: 'SLK-8492019',
        passings: [
          { id: 'pass_1', gate: 'Al Safa Toll Gate', fee: 4.0, time: 'Today, 08:24 AM', direction: 'Southbound (Jebel Ali)' },
          { id: 'pass_2', gate: 'Al Barsha Toll Gate', fee: 4.0, time: 'Yesterday, 06:15 PM', direction: 'Northbound (Deira)' },
          { id: 'pass_3', gate: 'Al Maktoum Toll Gate', fee: 4.0, time: '2 days ago, 09:10 AM', direction: 'Bur Dubai' },
        ],
      },
    };
  }

  // ---------------------------------------------------------------------------
  // DEWA EV Green Charger Network Endpoints
  // ---------------------------------------------------------------------------
  if (normMethod === 'GET' && (pathname === '/mobility/ev/chargers' || pathname === '/ev/chargers')) {
    return {
      status: 200,
      data: {
        success: true,
        count: evChargerStations.length,
        chargers: evChargerStations,
      },
    };
  }

  if (normMethod === 'POST' && (pathname === '/mobility/ev/start' || pathname === '/ev/start')) {
    const chargerId = body.chargerId;
    const charger = evChargerStations.find(c => c.id === chargerId);
    if (!charger) return { status: 404, data: { error: 'Charger not found' } };
    return {
      status: 200,
      data: {
        success: true,
        sessionId: `EV-SES-${Date.now()}`,
        station: charger.name,
        plugType: charger.plugTypes[0],
        pricePerKWh: `${charger.pricePerKWh} AED`,
        plateNumber: body.plateNumber,
        status: 'CHARGING_ACTIVE',
        startTime: new Date().toISOString(),
      },
    };
  }

  // 2. Available rides
  if (normMethod === 'GET' && pathname === '/rides/options') {
    const destination = query.destination || 'Downtown';
    return {
      status: 200,
      data: {
        success: true,
        destination,
        options: drivers,
      },
    };
  }

  // 3. Book a cab
  if (normMethod === 'POST' && pathname === '/rides/book') {
    const driverId = body.driverId;
    const selectedDriver = drivers.find(d => d.id === driverId);
    if (!selectedDriver) return { status: 404, data: { error: 'Driver not found' } };
    const bookingId = `bk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const booking: RideBooking = {
      bookingId,
      driver: selectedDriver,
      status: 'DISPATCHED',
      pickup: body.pickup || 'Current Location (100 Market St)',
      dropoff: body.dropoff || 'Selected Destination',
      fare: selectedDriver.fare,
      etaMinutes: selectedDriver.etaMinutes,
      createdAt: Date.now(),
    };

    activeRides.set(bookingId, booking);
    return {
      status: 200,
      data: {
        success: true,
        booking,
      },
    };
  }

  // 4. Live telemetry & tracking
  if (normMethod === 'GET' && pathname.startsWith('/rides/track/')) {
    const bookingId = pathname.replace('/rides/track/', '');
    const booking = activeRides.get(bookingId);

    if (!booking) {
      return {
        status: 200,
        data: {
          success: true,
          bookingId,
          status: 'IN_TRANSIT',
          etaMinutes: 3,
          driver: drivers[0],
          currentLocation: { lat: 37.7755, lng: -122.4180 },
          routeProgress: '65%',
        },
      };
    }

    return {
      status: 200,
      data: {
        success: true,
        booking,
        currentLocation: { lat: booking.driver.lat, lng: booking.driver.lng },
      },
    };
  }

  // 5. MCP Tool definitions
  if (normMethod === 'GET' && pathname === '/mcp') {
    return {
      status: 200,
      data: {
        protocol: 'mcp-1.0',
        service: 'service-ride',
        tools: [
          {
            name: 'ride_getOptions',
            description: 'Get available ride options, ETAs, and fares',
            parameters: {
              type: 'object',
              properties: {
                destination: { type: 'string', description: 'Dropoff destination address or landmark' },
              },
            },
          },
          {
            name: 'ride_bookCab',
            description: 'Book a ride with selected tier or driver',
            parameters: {
              type: 'object',
              properties: {
                driverId: { type: 'string', description: 'Selected driver or tier ID' },
                pickup: { type: 'string', description: 'Pickup location' },
                dropoff: { type: 'string', description: 'Dropoff location' },
              },
              required: ['driverId'],
            },
          },
          {
            name: 'ride_trackStatus',
            description: 'Track real-time location and ETA of an active ride booking',
            parameters: {
              type: 'object',
              properties: {
                bookingId: { type: 'string', description: 'Active ride booking ID' },
              },
              required: ['bookingId'],
            },
          },
        ],
      },
    };
  }

  return { status: 404, data: { error: 'Not found', path: pathname } };
}

// All transports and in-process callers pass through the same request contract.
export function executeRideRequest(method: string, pathname: string, query: Record<string, string> = {}, body: any = {}): { status: number; data: any } {
  const invalid = validateRequest('service-ride', method.toUpperCase(), pathname, query, body);
  if (invalid) return invalid;
  const result = handleRideRequest(method, pathname, query, body);
  if (pathname === '/mcp' && result.data.tools) {
    result.data.tools = result.data.tools.map((tool: any) => ({ ...tool,
      parameters: toolSchema('service-ride', tool.name) || tool.parameters }));
  }
  return result;
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

export const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  if (method === 'POST') {
    let bodyText = '';
    req.on('data', (chunk) => (bodyText += chunk));
    req.on('end', () => {
      try {
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = executeRideRequest(method, url.pathname, query, body);
        sendJson(res, result.status, result.data);
      } catch (e: any) {
        sendJson(res, 400, { error: 'Invalid JSON body', details: e.message });
      }
    });
  } else {
    const result = executeRideRequest(method, url.pathname, query);
    sendJson(res, result.status, result.data);
  }
});

export const executeMobilityRequest = executeRideRequest;

const PORT = parseInt(process.env.PORT || '4001', 10);
// Only bind port if not running in pure module import mode
if (process.argv[1]?.endsWith('service-ride/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚖 Smart Mobility (RTA/Salik/EV) Microservice listening on port ${PORT}`);
  });
}
