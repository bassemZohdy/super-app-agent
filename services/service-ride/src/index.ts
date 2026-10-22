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

export function executeRideRequest(
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
        service: 'service-ride',
        port: 4001,
        timestamp: new Date().toISOString(),
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
    const driverId = body.driverId || drivers[0].id;
    const selectedDriver = drivers.find((d) => d.id === driverId) || drivers[0];
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

const PORT = parseInt(process.env.PORT || '4001', 10);
// Only bind port if not running in pure module import mode
if (process.argv[1]?.endsWith('service-ride/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚖 Ride Microservice listening on port ${PORT}`);
  });
}
