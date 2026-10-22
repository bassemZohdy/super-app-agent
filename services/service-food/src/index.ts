import http from 'node:http';

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  description: string;
  dietary?: string[];
}

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  deliveryTime: string;
  deliveryFee: number;
  items: MenuItem[];
}

export const restaurants: Restaurant[] = [
  {
    id: 'rest_1',
    name: 'Pizza Napoli & Trattoria',
    cuisine: 'Italian / Pizza',
    rating: 4.8,
    deliveryTime: '20-30 mins',
    deliveryFee: 2.99,
    items: [
      { id: 'item_diavola', name: 'Woodfired Pizza Diavola', price: 18.0, description: 'Spicy salami, San Marzano tomatoes, fresh mozzarella', dietary: ['Spicy'] },
      { id: 'item_margherita', name: 'Classic Pizza Margherita', price: 15.5, description: 'Fresh basil, buffalo mozzarella, extra virgin olive oil', dietary: ['Vegetarian'] },
      { id: 'item_tagliatelle', name: 'Truffle Tagliatelle', price: 22.5, description: 'Black truffle butter, parmigiano reggiano, handmade pasta', dietary: ['Vegetarian'] },
    ],
  },
  {
    id: 'rest_2',
    name: 'Sushi Omakase Express',
    cuisine: 'Japanese / Sushi',
    rating: 4.9,
    deliveryTime: '25-35 mins',
    deliveryFee: 3.49,
    items: [
      { id: 'item_salmon_roll', name: 'Spicy Salmon Crunch Roll', price: 16.0, description: 'Atlantic salmon, avocado, spicy mayo, crispy shallots', dietary: ['Seafood'] },
      { id: 'item_nigiri_set', name: 'Chef Nigiri Sampler (8 pcs)', price: 28.0, description: 'Tuna, salmon, yellowtail, unagi with fresh wasabi', dietary: ['Seafood'] },
    ],
  },
  {
    id: 'rest_3',
    name: 'Green Fork Organic Bistro',
    cuisine: 'Healthy / Bowls & Salads',
    rating: 4.7,
    deliveryTime: '15-25 mins',
    deliveryFee: 1.99,
    items: [
      { id: 'item_grain_bowl', name: 'Warm Quinoa & Avocado Bowl', price: 14.5, description: 'Roasted sweet potato, kale, tahini dressing', dietary: ['Vegan', 'Gluten-Free'] },
      { id: 'item_smoothie', name: 'Immunity Citrus Smoothie', price: 7.5, description: 'Ginger, orange, turmeric, chia seeds', dietary: ['Vegan'] },
    ],
  },
];

export interface FoodOrder {
  orderId: string;
  restaurantId: string;
  restaurantName: string;
  items: Array<{ item: MenuItem; quantity: number }>;
  totalAmount: number;
  deliveryAddress: string;
  status: 'ACCEPTED_BY_KITCHEN' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
  estimatedDeliveryTime: string;
  createdAt: number;
}

export const activeOrders = new Map<string, FoodOrder>();

export function executeFoodRequest(
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
        service: 'service-food',
        port: 4002,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // 2. Search restaurants and menus
  if (normMethod === 'GET' && pathname === '/restaurants/search') {
    const q = (query.query || '').toLowerCase().trim();
    if (!q) {
      return { status: 200, data: { success: true, count: restaurants.length, restaurants } };
    }

    const filtered = restaurants.filter((r) => {
      const matchName = r.name.toLowerCase().includes(q);
      const matchCuisine = r.cuisine.toLowerCase().includes(q);
      const matchItems = r.items.some((item) =>
        item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
      );
      return matchName || matchCuisine || matchItems;
    });

    return { status: 200, data: { success: true, count: filtered.length, restaurants: filtered } };
  }

  // 3. Create food order
  if (normMethod === 'POST' && pathname === '/orders/create') {
    const restaurantId = body.restaurantId || restaurants[0].id;
    const targetRestaurant = restaurants.find((r) => r.id === restaurantId) || restaurants[0];

    const itemIds: string[] = body.items || [targetRestaurant.items[0].id];
    const orderItems: Array<{ item: MenuItem; quantity: number }> = [];
    let total = 0;

    for (const itemId of itemIds) {
      const found = targetRestaurant.items.find((i) => i.id === itemId);
      if (found) {
        orderItems.push({ item: found, quantity: 1 });
        total += found.price;
      }
    }

    if (orderItems.length === 0) {
      orderItems.push({ item: targetRestaurant.items[0], quantity: 1 });
      total += targetRestaurant.items[0].price;
    }

    total += targetRestaurant.deliveryFee;
    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const order: FoodOrder = {
      orderId,
      restaurantId: targetRestaurant.id,
      restaurantName: targetRestaurant.name,
      items: orderItems,
      totalAmount: Math.round(total * 100) / 100,
      deliveryAddress: body.deliveryAddress || '100 Market St, Apt 4B',
      status: 'ACCEPTED_BY_KITCHEN',
      estimatedDeliveryTime: '25 mins',
      createdAt: Date.now(),
    };

    activeOrders.set(orderId, order);
    return { status: 200, data: { success: true, order } };
  }

  // 4. Order tracking
  if (normMethod === 'GET' && pathname.startsWith('/orders/track/')) {
    const orderId = pathname.replace('/orders/track/', '');
    const order = activeOrders.get(orderId);

    if (!order) {
      return {
        status: 200,
        data: {
          success: true,
          orderId,
          status: 'PREPARING',
          restaurantName: restaurants[0].name,
          estimatedDeliveryTime: '20 mins',
          kitchenProgress: '80%',
        },
      };
    }

    return { status: 200, data: { success: true, order } };
  }

  // 5. MCP Endpoint
  if (normMethod === 'GET' && pathname === '/mcp') {
    return {
      status: 200,
      data: {
        protocol: 'mcp-1.0',
        service: 'service-food',
        tools: [
          {
            name: 'food_searchRestaurants',
            description: 'Search available restaurants, cuisines, and dish menus',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Dish name, cuisine, or restaurant keyword' },
              },
            },
          },
          {
            name: 'food_createOrder',
            description: 'Place food delivery order to restaurant kitchen',
            parameters: {
              type: 'object',
              properties: {
                restaurantId: { type: 'string', description: 'Restaurant ID' },
                items: { type: 'array', items: { type: 'string' }, description: 'List of item IDs to order' },
                deliveryAddress: { type: 'string', description: 'Destination address' },
              },
              required: ['restaurantId', 'items'],
            },
          },
          {
            name: 'food_trackOrder',
            description: 'Track kitchen preparation and delivery progress of an order',
            parameters: {
              type: 'object',
              properties: {
                orderId: { type: 'string', description: 'Active food order ID' },
              },
              required: ['orderId'],
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
        const result = executeFoodRequest(method, url.pathname, query, body);
        sendJson(res, result.status, result.data);
      } catch (e: any) {
        sendJson(res, 400, { error: 'Invalid JSON body', details: e.message });
      }
    });
  } else {
    const result = executeFoodRequest(method, url.pathname, query);
    sendJson(res, result.status, result.data);
  }
});

const PORT = parseInt(process.env.PORT || '4002', 10);
if (process.argv[1]?.endsWith('service-food/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🍕 Food Microservice listening on port ${PORT}`);
  });
}
