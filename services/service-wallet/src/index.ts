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

// -----------------------------------------------------------------------------
// Smart City Citizen Pay: Dubai Police & Abu Dhabi Police Traffic Fines
// -----------------------------------------------------------------------------
export interface PoliceTrafficFine {
  fineId: string;
  agency: 'Dubai Police' | 'Abu Dhabi Police' | 'RTA Traffic';
  plateNumber: string;
  violation: string;
  location: string;
  date: string;
  originalAmount: number;
  discountAmount: number;
  payableAmount: number;
  blackPoints: number;
  status: 'UNPAID' | 'PAID';
  receiptNumber?: string;
  paidAt?: string;
}

export const policeFines: PoliceTrafficFine[] = [
  {
    fineId: 'DP-2026-894102',
    agency: 'Dubai Police',
    plateNumber: 'Dubai B-74892',
    violation: 'Radar Speeding (+20 km/h threshold)',
    location: 'Sheikh Zayed Road near Financial Centre',
    date: '2026-10-18 11:42 AM',
    originalAmount: 300.0,
    discountAmount: 30.0, // 10% early payment discount
    payableAmount: 270.0,
    blackPoints: 0,
    status: 'UNPAID',
  },
  {
    fineId: 'RTA-2026-449102',
    agency: 'RTA Traffic',
    plateNumber: 'Dubai B-74892',
    violation: 'Public Parking Meter Overstay (Zone 302A)',
    location: 'Downtown Boulevard',
    date: '2026-10-15 04:30 PM',
    originalAmount: 150.0,
    discountAmount: 0.0,
    payableAmount: 150.0,
    blackPoints: 0,
    status: 'UNPAID',
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
        service: 'service-citizenpay',
        domain: 'Unified Citizen Pay & Police Fines (DubaiPay / TAMM Pay)',
        port: 4003,
        balance,
        unpaidFines: policeFines.filter((f) => f.status === 'UNPAID').length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Traffic Fines Endpoints (Dubai Police & Abu Dhabi Police)
  // ---------------------------------------------------------------------------
  if (normMethod === 'GET' && (pathname === '/fines/check' || pathname === '/fines')) {
    const plate = query.plateNumber || 'Dubai B-74892';
    const activeFines = policeFines.filter((f) => f.status === 'UNPAID');
    const totalOriginal = activeFines.reduce((acc, f) => acc + f.originalAmount, 0);
    const totalPayable = activeFines.reduce((acc, f) => acc + f.payableAmount, 0);

    return {
      status: 200,
      data: {
        success: true,
        plateNumber: plate,
        agency: 'Dubai Police General HQ',
        count: activeFines.length,
        fines: activeFines,
        totalOriginal,
        totalPayable,
        discountApplied: totalOriginal - totalPayable,
        earlyDiscountAED: totalOriginal - totalPayable,
      },
    };
  }

  if (normMethod === 'POST' && (pathname === '/fines/pay' || pathname === '/fines/settle')) {
    const activeFines = policeFines.filter((f) => f.status === 'UNPAID');
    const totalDue = activeFines.reduce((acc, f) => acc + f.payableAmount, 0);

    if (balance < totalDue) {
      return {
        status: 400,
        data: {
          error: 'Insufficient citizen wallet balance to settle police fines',
          currentBalance: balance,
          requiredAmount: totalDue,
        },
      };
    }

    balance -= totalDue;
    const txId = `DP-PAY-${Date.now()}`;
    const paidAt = new Date().toISOString();

    activeFines.forEach((f) => {
      f.status = 'PAID';
      f.receiptNumber = txId;
      f.paidAt = paidAt;
    });

    transactions.push({
      id: txId,
      type: 'PAYMENT',
      amount: totalDue,
      currency: 'AED',
      purpose: `Settlement of ${activeFines.length} Police Traffic Fines`,
      status: 'SETTLED',
      timestamp: Date.now(),
    });

    return {
      status: 200,
      data: {
        success: true,
        receiptNumber: txId,
        amountPaid: totalDue,
        finesCleared: activeFines.length,
        remainingBalance: balance,
        message: 'All traffic fines settled with Dubai Police. Zero black points added.',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Unified Multi-Agency Government Settlement (DubaiPay / TAMM Pay)
  // ---------------------------------------------------------------------------
  if (normMethod === 'POST' && (pathname === '/pay/unified' || pathname === '/pay/multi-agency')) {
    const items: Array<{ agency: string; purpose: string; amount: number }> = body.items || [
      { agency: 'DEWA', purpose: 'Premise DEWA-201948201 Electricity & Water', amount: 420.4 },
      { agency: 'Dubai Police', purpose: 'Traffic Violations (Radar + Overstay)', amount: 420.0 },
      { agency: 'RTA Salik', purpose: 'Toll Tag SLK-8492019 Auto-Topup', amount: 100.0 },
    ];

    const grandTotal = items.reduce((acc, it) => acc + it.amount, 0);

    // DubaiPay / TAMM Unified Gateway supports direct card backing / Apple Pay when wallet is below grand total
    if (balance >= grandTotal) {
      balance = Math.round((balance - grandTotal) * 100) / 100;
    } else {
      // Settled via DubaiPay registered card (Visa **** 4242)
      balance = 250.0; // Wallet topped up / kept positive
    }

    const govTxHash = `GOV-TX-DXB-${Date.now()}-${Math.floor(Math.random() * 90000 + 10000)}`;

    transactions.push({
      id: govTxHash,
      type: 'PAYMENT',
      amount: grandTotal,
      currency: 'AED',
      purpose: 'Unified Civic Living Reconciliation (DEWA + Police + Salik)',
      status: 'SETTLED',
      timestamp: Date.now(),
      referenceId: govTxHash,
    });

    return {
      status: 200,
      data: {
        success: true,
        govTransactionHash: govTxHash,
        settlementPlatform: 'DubaiPay / TAMM Unified Gateway',
        grandTotal,
        remainingBalance: balance,
        breakdown: items,
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

export const executeCitizenPayRequest = executeWalletRequest;

const PORT = parseInt(process.env.PORT || '4003', 10);
if (process.argv[1]?.endsWith('service-wallet/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`💳 Citizen Pay & Government Wallet Microservice listening on port ${PORT}`);
  });
}
