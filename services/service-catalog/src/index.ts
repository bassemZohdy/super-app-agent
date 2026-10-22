import http from 'node:http';

export interface MiniAppManifest {
  id: string;
  name: string;
  category: 'mobility' | 'food' | 'fintech';
  icon: string;
  version: string;
  entryRoute: string;
  remoteUrl: string;
  description: string;
  permissions: string[];
  mcpEndpoint: string;
}

export const miniApps: MiniAppManifest[] = [
  {
    id: 'org.superapp.ride',
    name: 'Ride & Mobility',
    category: 'mobility',
    icon: 'car',
    version: '1.0.0',
    entryRoute: '/ride',
    remoteUrl: 'http://localhost:3010/remoteEntry.js',
    description: 'Book rides, schedule pickups, and track drivers in real-time',
    permissions: ['geolocation', 'notifications'],
    mcpEndpoint: 'http://localhost:4001/mcp',
  },
  {
    id: 'org.superapp.food',
    name: 'Food & Dining',
    category: 'food',
    icon: 'utensils',
    version: '1.0.0',
    entryRoute: '/food',
    remoteUrl: 'http://localhost:3011/remoteEntry.js',
    description: 'Order from local restaurants and grocery delivery with live prep tracking',
    permissions: ['notifications', 'camera'],
    mcpEndpoint: 'http://localhost:4002/mcp',
  },
  {
    id: 'org.superapp.wallet',
    name: 'Wallet & Payments',
    category: 'fintech',
    icon: 'wallet',
    version: '1.0.0',
    entryRoute: '/wallet',
    remoteUrl: 'http://localhost:3012/remoteEntry.js',
    description: 'Manage digital cards, top-up funds, and view receipts with zero-trust isolation',
    permissions: ['biometrics', 'secure_storage'],
    mcpEndpoint: 'http://localhost:4003/mcp',
  },
];

export function executeCatalogRequest(
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
        service: 'service-catalog',
        port: 4004,
        totalMiniApps: miniApps.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // 2. Mini-App Catalog endpoint
  if (normMethod === 'GET' && pathname === '/miniapps') {
    return {
      status: 200,
      data: {
        success: true,
        count: miniApps.length,
        miniApps,
      },
    };
  }

  // 3. Mini-app by ID
  if (normMethod === 'GET' && pathname.startsWith('/miniapps/')) {
    const id = pathname.replace('/miniapps/', '');
    const found = miniApps.find((app) => app.id === id);
    if (!found) {
      return { status: 404, data: { error: 'Mini-app not found', id } };
    }
    return { status: 200, data: { success: true, miniApp: found } };
  }

  // 4. Federated Tools Aggregator for Agent Gateway
  if (normMethod === 'GET' && pathname === '/tools') {
    return {
      status: 200,
      data: {
        success: true,
        services: miniApps.map((app) => ({
          miniAppId: app.id,
          name: app.name,
          mcpEndpoint: app.mcpEndpoint,
        })),
        registeredTools: [
          { domain: 'ride', name: 'ride_getOptions', description: 'Get available ride options, ETAs, and fares' },
          { domain: 'ride', name: 'ride_bookCab', description: 'Book a ride with selected tier or driver' },
          { domain: 'ride', name: 'ride_trackStatus', description: 'Track real-time location and ETA of an active ride booking' },
          { domain: 'food', name: 'food_searchRestaurants', description: 'Search available restaurants, cuisines, and dish menus' },
          { domain: 'food', name: 'food_createOrder', description: 'Place food delivery order to restaurant kitchen' },
          { domain: 'food', name: 'food_trackOrder', description: 'Track kitchen preparation and delivery progress of an order' },
          { domain: 'wallet', name: 'wallet_getBalance', description: 'Fetch user current wallet balance and currency code' },
          { domain: 'wallet', name: 'wallet_authorizePayment', description: 'Authorize and deduct payment amount from wallet' },
          { domain: 'wallet', name: 'wallet_getTransactions', description: 'Fetch recent ledger transactions and receipts' },
          { domain: 'profile', name: 'profile_getProfile', description: 'Fetch authenticated user profile, tier, and avatar' },
          { domain: 'profile', name: 'profile_getPreferences', description: 'Fetch dietary, mobility, and UI theme preferences' },
          { domain: 'profile', name: 'profile_updatePreferences', description: 'Update user preferences dynamically' },
          { domain: 'profile', name: 'profile_getPromptContext', description: 'Fetch personalized system prompt instructions' },
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
        const result = executeCatalogRequest(method, url.pathname, query, body);
        sendJson(res, result.status, result.data);
      } catch (e: any) {
        sendJson(res, 400, { error: 'Invalid JSON body', details: e.message });
      }
    });
  } else {
    const result = executeCatalogRequest(method, url.pathname, query);
    sendJson(res, result.status, result.data);
  }
});

const PORT = parseInt(process.env.PORT || '4004', 10);
if (process.argv[1]?.endsWith('service-catalog/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`📦 Mini-App Catalog Service listening on port ${PORT}`);
  });
}
