import { createApplicationServer } from '../../../packages/backend-kit/src/application.ts';
import { validateRequest, toolSchema, invalidInput, toMinor, fromMinor, MAX_MONEY } from '../../../packages/protocol-core/src/request-validation.ts';

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

// -----------------------------------------------------------------------------
// Smart City Utilities Models: DEWA & ADDC Electricity, Water & Green Living
// -----------------------------------------------------------------------------
export interface UtilityAccount {
  premiseId: string;
  accountNumber: string;
  consumerName: string;
  community: string;
  unit: string;
  activeContract: string;
  smartMeterId: string;
  electricity: {
    currentKWh: number;
    slabTariff: string;
    ratePerKWh: number;
    cost: number;
  };
  water: {
    currentGallons: number;
    slabTariff: string;
    ratePerGallon: number;
    cost: number;
  };
  housingMunicipalityFee: number;
  sewerageFee: number;
  carbonOffsetKg: number;
  rooftopSolarCreditKWh: number;
  telemetry?: {
    electricityKwh: number;
    waterGallons: number;
    tariffSlab: string;
    carbonSavedKg: number;
  };
}

export let defaultUtilityAccount: UtilityAccount = {
  premiseId: 'DEWA-201948201',
  accountNumber: 'ACC-DEWA-94812',
  consumerName: 'Bassem Zohdy',
  community: 'Downtown Dubai',
  unit: 'Residences 1, Unit 1402',
  activeContract: 'EJR-2026-948102',
  smartMeterId: 'SM-DXB-99824',
  electricity: {
    currentKWh: 480,
    slabTariff: 'Green Slab (<=2000 kWh/mo)',
    ratePerKWh: 0.23,
    cost: 110.4,
  },
  water: {
    currentGallons: 1200,
    slabTariff: 'Standard Slab (<=6000 gal/mo)',
    ratePerGallon: 0.035,
    cost: 42.0,
  },
  housingMunicipalityFee: 240.0, // 5% annual rent installment
  sewerageFee: 28.0,
  carbonOffsetKg: 142.0,
  rooftopSolarCreditKWh: 95.0,
  telemetry: {
    electricityKwh: 480,
    waterGallons: 1200,
    tariffSlab: 'Green Slab (<=2000 kWh/mo)',
    carbonSavedKg: 142.0,
  },
};

export interface UtilityBill {
  billId: string;
  premiseId: string;
  accountNumber: string;
  billingMonth: string;
  electricityCost: number;
  waterCost: number;
  housingFee: number;
  sewerageFee: number;
  totalAmount: number;
  currency: string;
  status: 'UNPAID' | 'PAID';
  dueDate: string;
  receiptNumber?: string;
  paidAt?: string;
  breakdown?: {
    electricity: number;
    water: number;
    housingFee: number;
    sewerage: number;
  };
}

export let activeUtilityBill: UtilityBill = {
  billId: 'DEWA-2026-10-8492',
  premiseId: 'DEWA-201948201',
  accountNumber: 'ACC-DEWA-94812',
  billingMonth: 'October 2026',
  electricityCost: 110.4,
  waterCost: 42.0,
  housingFee: 240.0,
  sewerageFee: 28.0,
  totalAmount: 420.4,
  currency: 'AED',
  status: 'UNPAID',
  dueDate: '2026-10-31',
  breakdown: {
    electricity: 110.4,
    water: 42.0,
    housingFee: 240.0,
    sewerage: 28.0,
  },
};

function handleFoodRequest(
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
        service: 'service-utilities',
        domain: 'Smart Utilities & Energy (DEWA/ADDC)',
        port: 4002,
        activeBillStatus: activeUtilityBill.status,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Smart Utilities Endpoints (DEWA / ADDC)
  // ---------------------------------------------------------------------------
  if (normMethod === 'GET' && (pathname === '/utilities/consumption' || pathname === '/consumption')) {
    return {
      status: 200,
      data: {
        success: true,
        account: defaultUtilityAccount,
        ecoStatus: 'Excellent (Green Efficiency Zone)',
        carbonOffsetSavings: `${defaultUtilityAccount.carbonOffsetKg} kg CO2 saved this cycle`,
      },
    };
  }

  if (normMethod === 'GET' && (pathname === '/utilities/bill' || pathname === '/bill')) {
    return {
      status: 200,
      data: {
        success: true,
        bill: activeUtilityBill,
      },
    };
  }

  if (normMethod === 'POST' && (pathname === '/utilities/pay' || pathname === '/bill/pay')) {
    if (body.billId !== activeUtilityBill.billId) return { status: 404, data: { error: 'Utility bill not found' } };
    activeUtilityBill.status = 'PAID';
    activeUtilityBill.receiptNumber = `REC-DEWA-${Date.now()}`;
    activeUtilityBill.paidAt = new Date().toISOString();

    return {
      status: 200,
      data: {
        success: true,
        message: `Utility bill ${activeUtilityBill.billId} paid in full`,
        receipt: {
          billId: activeUtilityBill.billId,
          receiptNumber: activeUtilityBill.receiptNumber,
          amountPaid: `${activeUtilityBill.totalAmount} ${activeUtilityBill.currency}`,
          premiseId: activeUtilityBill.premiseId,
          paidAt: activeUtilityBill.paidAt,
          greenPointsAwarded: 50,
        },
      },
    };
  }

  if (normMethod === 'GET' && (pathname === '/utilities/eco-advice' || pathname === '/eco-advice')) {
    return {
      status: 200,
      data: {
        success: true,
        premiseId: defaultUtilityAccount.premiseId,
        advice: [
          '⚡ Peak hours are between 12:00 PM and 06:00 PM. Run washing machines & high-load devices in the morning.',
          '🌱 You are currently in the Green Slab (0.23 AED/kWh). Keeping below 2,000 kWh saves 28% monthly.',
          '☀️ Rooftop solar integration credited 95 kWh back to your grid account this month.',
        ],
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
    const restaurantId = body.restaurantId;
    const targetRestaurant = restaurants.find(r => r.id === restaurantId);
    if (!targetRestaurant) return { status: 404, data: { error: 'Restaurant not found' } };
    if (body.items.some((id: string) => !targetRestaurant.items.some(item => item.id === id))) {
      return { status: 404, data: { error: 'Menu item not found for this restaurant' } };
    }

    const itemIds: string[] = body.items;
    const orderItems: Array<{ item: MenuItem; quantity: number }> = [];
    let totalMinor = 0;

    for (const itemId of itemIds) {
      const found = targetRestaurant.items.find((i) => i.id === itemId);
      if (found) {
        orderItems.push({ item: found, quantity: 1 });
        totalMinor += toMinor(found.price);
      }
    }

    totalMinor += toMinor(targetRestaurant.deliveryFee);
    if (totalMinor > MAX_MONEY * 100) return invalidInput('Order total exceeds demo limit');
    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const order: FoodOrder = {
      orderId,
      restaurantId: targetRestaurant.id,
      restaurantName: targetRestaurant.name,
      items: orderItems,
      totalAmount: fromMinor(totalMinor),
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

    if (!order) return { status: 404, data: { success: false, error: 'Order not found', code: 'NOT_FOUND' } };

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

// All transports and in-process callers pass through the same request contract.
export function executeFoodRequest(method: string, pathname: string, query: Record<string, string> = {}, body: any = {}): { status: number; data: any } {
  const invalid = validateRequest('service-food', method.toUpperCase(), pathname, query, body);
  if (invalid) return invalid;
  const result = handleFoodRequest(method, pathname, query, body);
  if (pathname === '/mcp' && result.data.tools) {
    result.data.tools = result.data.tools.map((tool: any) => ({ ...tool,
      parameters: toolSchema('service-food', tool.name) || tool.parameters }));
  }
  return result;
}

export const server = createApplicationServer('service-food', executeFoodRequest);

export const executeUtilitiesRequest = executeFoodRequest;

const PORT = parseInt(process.env.PORT || '4002', 10);
if (process.argv[1]?.endsWith('service-food/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ Smart Utilities (DEWA/ADDC) Microservice listening on port ${PORT}`);
  });
}
