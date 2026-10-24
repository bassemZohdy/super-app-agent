/** Isolated local APIs/SQLite, with the existing local Keycloak and Redis only. */
import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';

export async function startEnvironment(options:{authorizationClock?:()=>number;issuerOperatorSub?:string}={}) {
  const appPort = Number(process.env.E2E_APP_PORT || 3002);
  const corePort = Number(process.env.E2E_CORE_PORT || 14000);
  assert.ok([3000, 3001, 3002].includes(appPort), 'Use a free seeded Keycloak redirect port: 3000, 3001 or 3002');
  assert.ok(Number.isInteger(corePort) && corePort >= 10000 && corePort <= 65000, 'Invalid E2E_CORE_PORT');
  const issuer = 'http://localhost:8085/realms/superapp';
  const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
  assert.equal(discovery.status, 200, 'Start local Keycloak/Redis with npm run demo:up first');
  const dir = await mkdtemp(join(tmpdir(), 'cityside-e2e-'));
  const servers: Server[] = [];
  const databases: Array<{ close(): void }> = [];
  const providerStores = new Map<string, import('../../services/provider-simulator/src/database.ts').AccountDatabase>();
  const appUrl = `http://localhost:${appPort}`;
  const coreUrl = `http://localhost:${corePort}`;
  const realm = JSON.parse(await readFile('services/keycloak/realm-export.json', 'utf8'));
  const secret = (id: string) => realm.clients.find((client: { clientId: string }) => client.clientId === id).secret as string;
  for(const provider of ['rta','dewa','etisalat','du','police'])process.env[`PROVIDER_${provider.toUpperCase()}_CLAIM_SECRET`]=secret(`provider-${provider}-settlement`);
  Object.assign(process.env, {
    PROVIDER_INTEGRATION: 'true', DOMAIN_TRANSPORT: 'http', SESSION_STORE: 'redis',
    // Exercise the strict interactive provider lane; never proxy isolated tests to live grants.
    DELEGATION_ENABLED: 'true', DELEGATION_AUTHORITY_URL: 'http://127.0.0.1:1',
    REDIS_URL: 'redis://127.0.0.1:6379', SESSION_TTL_SECONDS: '600', DEMO_AUTH: 'false',
    NODE_ENV: 'development', ENABLE_LIVE_LLM: 'false', ENABLE_LOCAL_LLM: 'false', OPENROUTER_API_KEY: '',
    KEYCLOAK_ISSUER: issuer, KEYCLOAK_PUBLIC_ISSUER: issuer, KEYCLOAK_AUDIENCE: 'agent-core',
    KEYCLOAK_JWKS_URL: `${issuer}/protocol/openid-connect/certs`,
    KEYCLOAK_TOKEN_URL: `${issuer}/protocol/openid-connect/token`,
    KEYCLOAK_INTROSPECTION_URL: `${issuer}/protocol/openid-connect/token/introspect`,
    KEYCLOAK_INTROSPECTION_CLIENT_ID: 'cityside-verifier',
    KEYCLOAK_INTROSPECTION_CLIENT_SECRET: secret('cityside-verifier'),
    KEYCLOAK_REQUIRED_SCOPES: '', CORS_ORIGINS: appUrl,
    PROVIDER_SETTLEMENT_SECRET: secret('provider-settlements'), APP_DATA_DIR: join(dir, 'application'),
    HTTP_REQUESTS_PER_MINUTE: '10000',
  });
  for (const [index, name] of ['ride', 'food', 'wallet', 'catalog', 'profile', 'telecom'].entries()) {
    process.env[`SERVICE_${name.toUpperCase()}_URL`] = `http://localhost:${corePort + 1 + index}`;
    process.env[`SERVICE_${name.toUpperCase()}_CLIENT_SECRET`] = secret(`service-${name}`);
  }
  for (const [index, name] of ['rta', 'dewa', 'etisalat', 'du', 'police', 'dld', 'payments'].entries()) {
    process.env[`PROVIDER_${name.toUpperCase()}_URL`] = `http://localhost:${corePort + 101 + index}`;
  }
  async function listen(server: Server, port: number) {
    servers.push(server);
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', () => { server.off('error', fail); done(); }); });
  }
  const cleanup = async () => {
    await Promise.all(servers.map(server => new Promise<void>(done => {
      server.closeAllConnections(); server.close(() => done());
    })));
    const { redisSessions } = await import('../../services/agent-core/src/session-store.ts');
    await redisSessions()?.close();
    for (const database of databases) database.close();
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const lostSettlementResponses=new Set<string>();
    const { ProviderClient,UpstreamError }=await import('../../packages/backend-kit/src/provider-client.ts');
    const paymentClient=new ProviderClient('provider-settlements',secret('provider-settlements')),normalPaymentCall=paymentClient.call.bind(paymentClient);
    paymentClient.call=async(...args:Parameters<typeof normalPaymentCall>)=>{const result=await normalPaymentCall(...args);if(args[2]==='POST'&&args[3].endsWith('/payments')&&lostSettlementResponses.delete(args[0]))throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Isolated test lost the response after actual source commit.');return result;};
    const { createProviderServer } = await import('../../services/provider-simulator/src/index.ts');
    const { providerIds } = await import('../../services/provider-simulator/src/contracts.ts');
    let issuerScenario:import('../../services/provider-simulator/src/issuer-scenarios.ts').IssuerScenarioContext|undefined;
    if(options.issuerOperatorSub){const {SimulationRuns}=await import('../../services/provider-simulator/src/simulation-run.ts');const runs=new SimulationRuns(join(dir,'issuer-run.sqlite'));databases.push(runs);const run=runs.create(options.issuerOperatorSub,'issuer-outcomes',Date.now(),crypto.randomUUID());issuerScenario={runId:run.id,operatorSub:options.issuerOperatorSub,root:dir};}
    let paymentInstance:ReturnType<typeof createProviderServer>|undefined;

    for (const [index, name] of providerIds.entries()) {
      const provider = createProviderServer(name, join(dir, `${name}.sqlite`),name==='payments'?{authorizationClock:options.authorizationClock,paymentClient,issuerScenario}:{});
      providerStores.set(name, provider.store);if(name==='payments')paymentInstance=provider;
      databases.push(provider.store.db); await listen(provider.server, corePort + 101 + index);
    }
    for (const [index, name] of ['ride', 'food', 'wallet', 'catalog', 'profile', 'telecom'].entries()) {
      const module = await import(`../../services/service-${name}/src/index.ts`);
      await listen(module.server, corePort + 1 + index);
    }
    const { server } = await import('../../services/agent-core/src/index.ts');
    await listen(server, corePort);
    const { redisSessions } = await import('../../services/agent-core/src/session-store.ts');
    await redisSessions()!.connect();
    const web = join(dir, 'web'); await mkdir(web);
    console.log('Building an isolated React demo (live model calls disabled)…');
    await new Promise<void>((done, fail) => {
      const child = spawn('npm', ['run', 'build', '--workspace', 'apps/shell-react', '--', '--outDir', web], {
        env: { ...process.env, VITE_GATEWAY_URL: coreUrl }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = ''; child.stdout.on('data', data => { output = (output + data).slice(-6000); }); child.stderr.on('data', data => { output = (output + data).slice(-6000); });
      child.once('error', fail); child.once('exit', code => code === 0 ? done() : fail(new Error(`React build failed (${code}): ${output}`)));
    });
    const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.html': 'text/html' };
    await listen(http.createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url || '/', appUrl).pathname);
        const candidate = resolve(web, `.${pathname}`);
        if (candidate !== web && !candidate.startsWith(`${web}/`)) { response.writeHead(400).end(); return; }
        let file = candidate;
        let content: Buffer;
        try { content = await readFile(file); } catch { file = join(web, 'index.html'); content = await readFile(file); }
        response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(content);
      } catch { response.writeHead(500).end('Demo asset unavailable'); }
    }), appPort);
    const { PaymentResourceUses } = await import('../../services/provider-simulator/src/payment-resource-uses.ts');
    const { ProviderPayables } = await import('../../services/provider-simulator/src/payables.ts');
    const restartPayments=async()=>{
      assert.ok(paymentInstance);const old=paymentInstance;await new Promise<void>(done=>{old.server.closeAllConnections();old.server.close(()=>done());});old.store.close();servers.splice(servers.indexOf(old.server),1);databases.splice(databases.indexOf(old.store.db),1);
      const next=createProviderServer('payments',join(dir,'payments.sqlite'),{authorizationClock:options.authorizationClock,paymentClient,issuerScenario});paymentInstance=next;providerStores.set('payments',next.store);databases.push(next.store.db);await listen(next.server,corePort+107);
    };
    return { appUrl, coreUrl, corePort, cleanup,issuerRunId:issuerScenario?.runId,restartPayments,paymentEventRecords:(provider:string,account:string)=>providerStores.get(provider)!.db.prepare('SELECT body FROM payment_event_outbox WHERE account_id=? ORDER BY rowid').all(account).map(row=>JSON.parse(String(row.body)) as import('../../packages/protocol-core/src/payment-events.ts').PaymentEvent),loseNextSettlementResponse:(provider:string)=>{assert.ok(['dewa','etisalat','du','police','rta'].includes(provider));lostSettlementResponses.add(provider);},providerState: (provider: string, account: string, kind: string) => providerStores.get(provider)?.get(account, kind),
      // Trusted test fixture only: no HTTP route can create/release lifecycle locks.
      bindPaymentUse: (account: string, binding: Parameters<InstanceType<typeof PaymentResourceUses>['bind']>[1]) => {
        const uses = new PaymentResourceUses(providerStores.get('payments')!); uses.bind(account,binding);
        return () => uses.release(account,binding.resourceType,binding.resourceId,binding.dependentKind,binding.dependentId);
      },
      // Trusted isolated lifecycle driver. Ordinary API clients cannot issue/amend obligations.
      payableBook: (provider: import('../../services/provider-simulator/src/payables.ts').PayableProvider) => new ProviderPayables(providerStores.get(provider)!,provider),
    };
  } catch (error) { await cleanup(); throw error; }
}
