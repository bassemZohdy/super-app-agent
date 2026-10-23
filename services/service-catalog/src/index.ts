import { createApplicationServer } from '../../../packages/backend-kit/src/application.ts';
import { validateRequest, toolSchema } from '../../../packages/protocol-core/src/request-validation.ts';
import http from 'node:http';
import { capabilities } from './capabilities.ts';

export interface MiniAppManifest {
  id: string;
  name: string;
  category: 'mobility' | 'food' | 'fintech' | 'housing' | 'utilities';
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
    id: 'gov.smartcity.mobility',
    name: 'Smart Mobility & Parking',
    category: 'mobility',
    icon: 'car',
    version: '2.0.0',
    entryRoute: '/mobility',
    remoteUrl: 'http://localhost:3010/remoteEntry.js',
    description: 'RTA & Mawaqif smart parking meters, Salik toll management, and DEWA EV green chargers',
    permissions: ['geolocation', 'notifications'],
    mcpEndpoint: 'http://localhost:4001/mcp',
  },
  {
    id: 'gov.smartcity.utilities',
    name: 'Smart Utilities (DEWA / ADDC)',
    category: 'utilities',
    icon: 'zap',
    version: '2.0.0',
    entryRoute: '/utilities',
    remoteUrl: 'http://localhost:3011/remoteEntry.js',
    description: 'Electricity & water smart meter telemetry, billing, and Green Slab eco-tariffs',
    permissions: ['notifications'],
    mcpEndpoint: 'http://localhost:4002/mcp',
  },
  {
    id: 'gov.smartcity.citizenpay',
    name: 'Citizen Pay & Police Fines',
    category: 'fintech',
    icon: 'shield',
    version: '2.0.0',
    entryRoute: '/citizenpay',
    remoteUrl: 'http://localhost:3012/remoteEntry.js',
    description: 'Unified civic payments and fines settlement, and digital wallet',
    permissions: ['biometrics', 'secure_storage'],
    mcpEndpoint: 'http://localhost:4003/mcp',
  },
  {
    id: 'gov.smartcity.housing',
    name: 'Housing & Tenancy (Ejari)',
    category: 'housing',
    icon: 'home',
    version: '2.0.0',
    entryRoute: '/housing',
    remoteUrl: 'http://localhost:3013/remoteEntry.js',
    description: 'Tenancy contract management, automated DEWA connection, and residential parking permits',
    permissions: ['secure_storage'],
    mcpEndpoint: 'http://localhost:4004/mcp',
  },
  // Backward compatibility alias for legacy tests
  {
    id: 'org.superapp.ride',
    name: 'Ride & Mobility',
    category: 'mobility',
    icon: 'car',
    version: '1.0.0',
    entryRoute: '/ride',
    remoteUrl: 'http://localhost:3010/remoteEntry.js',
    description: 'Legacy ride hailing alias',
    permissions: ['geolocation'],
    mcpEndpoint: 'http://localhost:4001/mcp',
  },
];

export interface EjariContract {
  contractNumber: string;
  tenantName: string;
  emiratesId: string;
  landlordName: string;
  property: {
    community: string;
    building: string;
    unitNumber: string;
    premiseId: string;
  };
  annualRent: number;
  annualRentAED?: number;
  startDate: string;
  endDate: string;
  status: 'ACTIVE_REGISTERED' | 'DRAFT' | 'EXPIRED';
}

export const defaultEjariContract: EjariContract = {
  contractNumber: 'EJR-2026-948102',
  tenantName: 'Bassem Zohdy',
  emiratesId: '784-1988-1234567-1',
  landlordName: 'Emaar Properties PJSC',
  property: {
    community: 'Downtown Dubai',
    building: 'Downtown Residences 1',
    unitNumber: 'Unit 1402',
    premiseId: 'DEWA-201948201',
  },
  annualRent: 96000.0,
  annualRentAED: 96000.0,
  startDate: '2026-11-01',
  endDate: '2027-10-31',
  status: 'ACTIVE_REGISTERED',
};

function handleCatalogRequest(
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
        domain: 'Smart City Ecosystem & Housing Services',
        port: 4004,
        totalMiniApps: miniApps.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Housing & Ejari Endpoints
  // ---------------------------------------------------------------------------
  if (normMethod === 'GET' && (pathname === '/housing/ejari' || pathname === '/ejari')) {
    return {
      status: 200,
      data: {
        success: true,
        contract: defaultEjariContract,
        verifiedAgency: 'Dubai Land Department (DLD) / RERA',
      },
    };
  }

  if (normMethod === 'POST' && (pathname === '/housing/move-in' || pathname === '/move-in')) {
    if (body.contractNumber !== defaultEjariContract.contractNumber) return { status: 404, data: { error: 'Tenancy contract not found' } };
    return {
      status: 200,
      data: {
        success: true,
        journey: 'Move-in Golden Path Onboarding',
        ejariContract: defaultEjariContract.contractNumber,
        unit: `${defaultEjariContract.property.building}, ${defaultEjariContract.property.unitNumber}`,
        dewaConnected: {
          premiseId: defaultEjariContract.property.premiseId,
          status: 'CONNECTED_ACTIVE',
          depositWaived: true, // Waived for Golden Visa holders
          message: 'Smart meter activated with zero security deposit.',
        },
        residentialParking: {
          zone: 'Zone 302A (Downtown Residential)',
          permitNumber: `PRM-${Date.now()}`,
          status: 'ISSUED',
        },
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

  // Versioned capability discovery; authorization enforcement remains P0-03/P1-10.
  if (normMethod === 'GET' && pathname === '/capabilities') {
    return { status: 200, data: { schemaVersion: '1.0.0', capabilities } };
  }
  if (normMethod === 'GET' && pathname.startsWith('/capabilities/')) {
    const id = pathname.slice('/capabilities/'.length);
    const capability = capabilities.find(item => item.id === id);
    return capability ? { status: 200, data: { capability } }
      : { status: 404, data: { error: 'Capability not found', id } };
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
        registeredTools: capabilities.map(capability => ({
          domain: capability.name.split('_')[0],
          name: capability.name,
          description: capability.description,
          capabilityId: capability.id,
          version: capability.version,
        })),
      },
    };
  }

  return { status: 404, data: { error: 'Not found', path: pathname } };
}

// All transports and in-process callers pass through the same request contract.
export function executeCatalogRequest(method: string, pathname: string, query: Record<string, string> = {}, body: any = {}): { status: number; data: any } {
  const invalid = validateRequest('service-catalog', method.toUpperCase(), pathname, query, body);
  if (invalid) return invalid;
  const result = handleCatalogRequest(method, pathname, query, body);
  if (pathname === '/mcp' && result.data.tools) {
    result.data.tools = result.data.tools.map((tool: any) => ({ ...tool,
      parameters: toolSchema('service-catalog', tool.name) || tool.parameters }));
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

export const server = createApplicationServer('service-catalog', executeCatalogRequest);

const PORT = parseInt(process.env.PORT || '4004', 10);
if (process.argv[1]?.endsWith('service-catalog/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`📦 Mini-App Catalog Service listening on port ${PORT}`);
  });
}

