import { shutdownOnSignal } from '../../../packages/backend-kit/src/shutdown.ts';
import { createApplicationServer } from '../../../packages/backend-kit/src/application.ts';
import { validateRequest, toolSchema, invalidInput, toMinor, fromMinor, MAX_MONEY } from '../../../packages/protocol-core/src/request-validation.ts';

export interface Transaction {
  id: string;
  type: 'PAYMENT' | 'TOPUP' | 'REFUND';
  amount: number;
  currency: string;
  purpose: string;
  status: 'SETTLED' | 'PENDING' | 'FAILED';
  timestamp: number;
  referenceId?: string;
  operationId?: string;
}

type OfflineUnifiedOperation = { signature: string; items: Array<{ agency: string; purpose: string; amount: number }>; receiptReference: string; response: Record<string, unknown> };
const offlineUnifiedOperations = new Map<string, OfflineUnifiedOperation>();

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

function handleWalletRequest(
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
    const activeFines = policeFines.filter((f) => f.status === 'UNPAID' && f.plateNumber === plate);
    const originalMinor = activeFines.reduce((acc, f) => acc + toMinor(f.originalAmount), 0);
    const payableMinor = activeFines.reduce((acc, f) => acc + toMinor(f.payableAmount), 0);
    const totalOriginal = originalMinor / 100, totalPayable = payableMinor / 100;

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
        discountApplied: (originalMinor - payableMinor) / 100,
        earlyDiscountAED: (originalMinor - payableMinor) / 100,
      },
    };
  }

  const fineReceipt = /^\/fines\/receipts\/([^/]+)$/.exec(pathname);
  if (normMethod === 'GET' && fineReceipt) {
    const receiptNumber = decodeURIComponent(fineReceipt[1]);
    const fines = policeFines.filter(fine => fine.status === 'PAID' && fine.receiptNumber === receiptNumber);
    return { status: 200, data: { success: true, receipt: fines.length ? { receiptNumber, currency: 'AED', fines: fines.map(fine => ({ fineId: fine.fineId, amountMinor: toMinor(fine.payableAmount) })) } : null } };
  }

  if (normMethod === 'POST' && (pathname === '/fines/pay' || pathname === '/fines/settle')) {
    if (body.expectedPayables !== undefined) return invalidInput('Reviewed payable revisions require integrated provider mode');
    const activeFines = policeFines.filter(f => body.fineIds.includes(f.fineId) && f.status === 'UNPAID');
    if (activeFines.length !== body.fineIds.length) return { status: 404, data: { error: 'Selected unpaid fine not found' } };
    const dueMinor = activeFines.reduce((acc, f) => acc + toMinor(f.payableAmount), 0);
    if (dueMinor > MAX_MONEY * 100) return invalidInput('Settlement total exceeds demo limit');
    const totalDue = fromMinor(dueMinor);
    if (body.expectedAmountMinor !== undefined && body.expectedAmountMinor !== dueMinor) {
      return { status: 409, data: { error: 'The reviewed fine amount changed', code: 'PAYABLE_CHANGED' } };
    }

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

    balance = fromMinor(toMinor(balance) - dueMinor);
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
        fineIds: activeFines.map(f => f.fineId),
        remainingBalance: balance,
        message: 'All traffic fines settled with Dubai Police. Zero black points added.',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Unified Multi-Agency Government Settlement (DubaiPay / TAMM Pay)
  // ---------------------------------------------------------------------------
  const unifiedOperation = /^\/wallet\/unified-operations\/([^/]+)$/.exec(pathname);
  if (normMethod === 'GET' && unifiedOperation) {
    const operationId = decodeURIComponent(unifiedOperation[1]), operation = offlineUnifiedOperations.get(operationId);
    return { status: 200, data: { success: true, operation: operation ? { operationId, status: 'SETTLED', items: structuredClone(operation.items), receiptReference: operation.receiptReference } : null } };
  }

  if (normMethod === 'POST' && (pathname === '/pay/unified' || pathname === '/pay/multi-agency')) {
    if (body.targetReference !== undefined || body.expectedTargetVersion !== undefined || body.expectedPayables !== undefined) return invalidInput('Selected-resource checkout requires integrated provider mode');
    const items: Array<{ agency: string; purpose: string; amount: number }> = body.items;
    const totalMinor = items.reduce((acc, item) => acc + toMinor(item.amount), 0);
    if (totalMinor > MAX_MONEY * 100) return invalidInput('Settlement total exceeds demo limit');
    const grandTotal = fromMinor(totalMinor);
    const signature = JSON.stringify({ items: items.map(item => ({ agency: item.agency, purpose: item.purpose, amountMinor: toMinor(item.amount) })), currency: body.currency ?? 'AED', methodId: body.methodId ?? null, expectedMethodVersion: body.expectedMethodVersion ?? null });
    const previous = body.operationId ? offlineUnifiedOperations.get(body.operationId) : undefined;
    if (previous) {
      if (previous.signature !== signature) return { status: 409, data: { success: false, code: 'IDEMPOTENCY_CONFLICT', error: 'This operation already has different terms.' } };
      return { status: 200, data: structuredClone(previous.response) };
    }

    if (toMinor(balance) < totalMinor) {
      return { status: 400, data: { error: 'Insufficient citizen wallet balance for unified settlement', currentBalance: balance, requiredAmount: grandTotal } };
    }
    balance = fromMinor(toMinor(balance) - totalMinor);

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
      ...(body.operationId ? { operationId: body.operationId } : {}),
    });

    const response = {
      success: true, govTransactionHash: govTxHash, settlementPlatform: 'DubaiPay / TAMM Unified Gateway', grandTotal,
      remainingBalance: balance, breakdown: structuredClone(items), timestamp: new Date().toISOString(), ...(body.operationId ? { operationId: body.operationId } : {}),
    };
    if (body.operationId) offlineUnifiedOperations.set(body.operationId, { signature, items: structuredClone(items), receiptReference: govTxHash, response });
    return { status: 200, data: structuredClone(response) };
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
    const amount = body.amount;

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

    balance = fromMinor(toMinor(balance) - toMinor(amount));

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
    const amount = body.amount;

    if (isNaN(amount) || amount <= 0) {
      return { status: 400, data: { error: 'Invalid top-up amount' } };
    }

    const nextBalance = toMinor(balance) + toMinor(amount);
    if (nextBalance > MAX_MONEY * 100) return invalidInput('Wallet balance exceeds demo limit');
    balance = fromMinor(nextBalance);

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

// All transports and in-process callers pass through the same request contract.
export function executeWalletRequest(method: string, pathname: string, query: Record<string, string> = {}, body: any = {}): { status: number; data: any } {
  const invalid = validateRequest('service-wallet', method.toUpperCase(), pathname, query, body);
  if (invalid) return invalid;
  const result = handleWalletRequest(method, pathname, query, body);
  if (pathname === '/mcp' && result.data.tools) {
    result.data.tools = result.data.tools.map((tool: any) => ({ ...tool,
      parameters: toolSchema('service-wallet', tool.name) || tool.parameters }));
  }
  return result;
}

export const server = createApplicationServer('service-wallet', executeWalletRequest);

export const executeCitizenPayRequest = executeWalletRequest;

const PORT = parseInt(process.env.PORT || '4003', 10);
if (process.argv[1]?.endsWith('service-wallet/src/index.ts')) {
  shutdownOnSignal(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`💳 Citizen Pay & Government Wallet Microservice listening on port ${PORT}`);
  });
}
