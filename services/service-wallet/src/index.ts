import http from 'node:http';

export interface Transaction {
  id: string;
  type: 'PAYMENT' | 'TOPUP' | 'REFUND';
  amount: number;
  currency: string;
  purpose: string;
  status: 'SETTLED' | 'PENDING' | 'FAILED';
  timestamp: number;
  referenceId?: string;
}

export let balance = 142.5;
export const currency = 'USD';
export const transactions: Transaction[] = [
  {
    id: 'tx_init_1',
    type: 'TOPUP',
    amount: 100.0,
    currency: 'USD',
    purpose: 'Initial Wallet Credit',
    status: 'SETTLED',
    timestamp: Date.now() - 86400000 * 2,
  },
  {
    id: 'tx_init_2',
    type: 'TOPUP',
    amount: 50.0,
    currency: 'USD',
    purpose: 'Card Auto-Reload',
    status: 'SETTLED',
    timestamp: Date.now() - 86400000,
  },
  {
    id: 'tx_init_3',
    type: 'PAYMENT',
    amount: 7.5,
    currency: 'USD',
    purpose: 'Morning Coffee Express',
    status: 'SETTLED',
    timestamp: Date.now() - 3600000 * 4,
  },
];

export function executeWalletRequest(
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
        service: 'service-wallet',
        port: 4003,
        balance,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // 2. Check Balance
  if (normMethod === 'GET' && pathname === '/wallet/balance') {
    return {
      status: 200,
      data: {
        success: true,
        currency,
        balance: Math.round(balance * 100) / 100,
      },
    };
  }

  // 3. Transactions Ledger
  if (normMethod === 'GET' && pathname === '/wallet/transactions') {
    return {
      status: 200,
      data: {
        success: true,
        count: transactions.length,
        transactions: [...transactions].reverse(),
      },
    };
  }

  // 4. Pay / Deduct Funds
  if (normMethod === 'POST' && pathname === '/wallet/pay') {
    const amount = typeof body.amount === 'number' ? body.amount : parseFloat(body.amount);

    if (isNaN(amount) || amount <= 0) {
      return { status: 400, data: { error: 'Invalid payment amount' } };
    }

    if (amount > balance) {
      return {
        status: 400,
        data: {
          error: 'Insufficient wallet balance',
          currentBalance: balance,
          requestedAmount: amount,
        },
      };
    }

    balance -= amount;
    balance = Math.round(balance * 100) / 100;

    const tx: Transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'PAYMENT',
      amount,
      currency,
      purpose: body.purpose || 'SuperApp Purchase',
      status: 'SETTLED',
      timestamp: Date.now(),
      referenceId: body.referenceId,
    };

    transactions.push(tx);

    return {
      status: 200,
      data: {
        success: true,
        transaction: tx,
        remainingBalance: balance,
      },
    };
  }

  // 5. Top-up Balance
  if (normMethod === 'POST' && pathname === '/wallet/topup') {
    const amount = typeof body.amount === 'number' ? body.amount : parseFloat(body.amount);

    if (isNaN(amount) || amount <= 0) {
      return { status: 400, data: { error: 'Invalid top-up amount' } };
    }

    balance += amount;
    balance = Math.round(balance * 100) / 100;

    const tx: Transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'TOPUP',
      amount,
      currency,
      purpose: body.source ? `Top-up from ${body.source}` : 'Wallet Reload',
      status: 'SETTLED',
      timestamp: Date.now(),
    };

    transactions.push(tx);

    return {
      status: 200,
      data: {
        success: true,
        transaction: tx,
        newBalance: balance,
      },
    };
  }

  // 6. MCP Protocol Endpoint
  if (normMethod === 'GET' && pathname === '/mcp') {
    return {
      status: 200,
      data: {
        protocol: 'mcp-1.0',
        service: 'service-wallet',
        tools: [
          {
            name: 'wallet_getBalance',
            description: 'Fetch user current wallet balance and currency code',
            parameters: { type: 'object', properties: {} },
          },
          {
            name: 'wallet_authorizePayment',
            description: 'Authorize and deduct payment amount from wallet',
            parameters: {
              type: 'object',
              properties: {
                amount: { type: 'number', description: 'Amount to pay in USD' },
                purpose: { type: 'string', description: 'Description or mini-app domain' },
                referenceId: { type: 'string', description: 'External booking or order ID' },
              },
              required: ['amount', 'purpose'],
            },
          },
          {
            name: 'wallet_getTransactions',
            description: 'Fetch recent ledger transactions and receipts',
            parameters: { type: 'object', properties: {} },
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
        const result = executeWalletRequest(method, url.pathname, query, body);
        sendJson(res, result.status, result.data);
      } catch (e: any) {
        sendJson(res, 400, { error: 'Invalid JSON body', details: e.message });
      }
    });
  } else {
    const result = executeWalletRequest(method, url.pathname, query);
    sendJson(res, result.status, result.data);
  }
});

const PORT = parseInt(process.env.PORT || '4003', 10);
if (process.argv[1]?.endsWith('service-wallet/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`💳 Wallet Microservice listening on port ${PORT}`);
  });
}
