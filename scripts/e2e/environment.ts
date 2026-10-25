import { keycloakIssuerUrl, redisUrl } from '../endpoints.ts';
/** Isolated local APIs/SQLite, with the existing local Keycloak and Redis only. */
import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';

export async function startEnvironment(options:{authorizationClock?:()=>number;issuerOperatorSub?:string;automation?:{operatorSub:string;workerSub:string}}={}) {
  const appPort = Number(process.env.E2E_APP_PORT || 3002);
  const corePort = Number(process.env.E2E_CORE_PORT || 14000);
  assert.ok([3000, 3001, 3002].includes(appPort), 'Use a free seeded Keycloak redirect port: 3000, 3001 or 3002');
  assert.ok(Number.isInteger(corePort) && corePort >= 10000 && corePort <= 65000, 'Invalid E2E_CORE_PORT');
  const issuer = keycloakIssuerUrl;
  const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
  assert.equal(discovery.status, 200, 'Start local Keycloak/Redis with npm run demo:up first');
  const dir = await mkdtemp(join(tmpdir(), options.automation ? 'cityside-auto-' : 'cityside-e2e-'));
  const servers: Server[] = [];
  const databases: Array<{ close(): void }> = [];
  const providerServers=new Map<string,Server>();
  const providerStores = new Map<string, import('../../services/provider-simulator/src/database.ts').AccountDatabase>();
  const appUrl = `http://localhost:${appPort}`;
  const coreUrl = `http://localhost:${corePort}`;
  const realm = JSON.parse(await readFile('services/keycloak/realm-export.json', 'utf8'));
  const secret = (id: string) => realm.clients.find((client: { clientId: string }) => client.clientId === id).secret as string;
  for(const provider of ['rta','dewa','etisalat','du','police'])process.env[`PROVIDER_${provider.toUpperCase()}_CLAIM_SECRET`]=secret(`provider-${provider}-settlement`);
  Object.assign(process.env, {
    ELIGIBILITY_ENFORCEMENT:'true',ELIGIBILITY_READER_SECRET:secret('provider-eligibility'),
    PROVIDER_INTEGRATION: 'true', DOMAIN_TRANSPORT: 'http', SESSION_STORE: 'redis',
    // Exercise the strict interactive provider lane; never proxy isolated tests to live grants.
    DELEGATION_ENABLED: 'true', DELEGATION_AUTHORITY_URL: 'http://127.0.0.1:1',
    REDIS_URL: redisUrl, SESSION_TTL_SECONDS: '600', DEMO_AUTH: 'false',
    OBSERVABILITY_LOGS:process.env.OBSERVABILITY_LOGS||'false',
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
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(port, options.automation && port === corePort + 107 ? '0.0.0.0' : '127.0.0.1', () => { server.off('error', fail); done(); }); });
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
    const lostSettlementResponses=new Set<string>(),heldAcknowledgements=new Set<string>(),failedPreparations=new Set<string>(),lostReversals=new Set<string>(),blockedSourceReads=new Set<string>();
    const {SettlementClient}=await import('../../services/provider-simulator/src/settlement-client.ts');
    const { ProviderClient,UpstreamError }=await import('../../packages/backend-kit/src/provider-client.ts');
    const paymentClient=new ProviderClient('provider-settlements',secret('provider-settlements')),normalPaymentCall=paymentClient.call.bind(paymentClient);
    paymentClient.call=async(...args:Parameters<typeof normalPaymentCall>)=>{
      if(args[2]==='GET'&&blockedSourceReads.has(args[0]))throw new UpstreamError(503,'SOURCE_UNAVAILABLE','Isolated test holds source status reads.');
      if(args[2]==='POST'&&args[3].endsWith('/admissions')&&failedPreparations.delete(args[0]))throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Isolated test lost preparation before source commit.');
      const result=await normalPaymentCall(...args);
      if(args[2]==='POST'&&(args[3].endsWith('/payments')&&lostSettlementResponses.delete(args[0])||args[3].startsWith('/payment-reversals/')&&lostReversals.delete(args[0])))throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Isolated test lost the response after actual source commit.');return result;
    };
    const { createProviderServer } = await import('../../services/provider-simulator/src/index.ts');
    const { providerIds } = await import('../../services/provider-simulator/src/contracts.ts');
    let issuerScenario:import('../../services/provider-simulator/src/issuer-scenarios.ts').IssuerScenarioContext|undefined;
    if(options.issuerOperatorSub){const {SimulationRuns}=await import('../../services/provider-simulator/src/simulation-run.ts');const runs=new SimulationRuns(join(dir,'issuer-run.sqlite'));databases.push(runs);const run=runs.create(options.issuerOperatorSub,'issuer-outcomes',Date.now(),crypto.randomUUID());issuerScenario={runId:run.id,operatorSub:options.issuerOperatorSub,root:dir};}
    let automationRun:import('../../services/provider-simulator/src/automation-runs.ts').AutomationRunContext|undefined;
    if(options.automation)automationRun={runId:`autorn_${crypto.randomUUID()}`,operatorSub:options.automation.operatorSub,workerSub:options.automation.workerSub,root:dir};
    const { ProviderEngine } = await import('../../services/provider-simulator/src/engine.ts');
    // Trusted run fixture: the isolated gateway reads source obligations and holds the shared exclusion claim in the source's own store.
    const automationIo={
      readPayables:(accountId:string,provider:string)=>['dewa','etisalat','du','police'].includes(provider)?new ProviderEngine(provider as 'dewa'|'etisalat'|'du'|'police',providerStores.get(provider)!).payables!.list(accountId):[],
      parkingExtensions:(provider:string)=>provider==='rta'&&providerStores.get('rta')?new ProviderEngine('rta',providerStores.get('rta')!).parkingExtensions:undefined,
      recharges:(provider:string)=>['rta','etisalat','du'].includes(provider)&&providerStores.get(provider)?new ProviderEngine(provider as 'rta'|'etisalat'|'du',providerStores.get(provider)!).recharges:undefined,
      providerStore:(provider:string)=>{const store=providerStores.get(provider);if(!store)throw new Error('No isolated store for this provider.');return store;},
    };
    let paymentInstance:ReturnType<typeof createProviderServer>|undefined;

    for (const [index, name] of providerIds.entries()) {
      const settlementTransport=name!=='payments'&&name!=='dld'?new SettlementClient(name):undefined;
      if(settlementTransport){const send=settlementTransport.call.bind(settlementTransport);settlementTransport.call=async(...args:Parameters<typeof send>)=>{if(args[2]==='ack'&&heldAcknowledgements.has(name))throw new Error('Isolated test holds original provider acknowledgement.');return send(...args);};}
      const provider = createProviderServer(name, join(dir, `${name}.sqlite`),name==='payments'?{authorizationClock:options.authorizationClock,paymentClient,issuerScenario,automationRun,automationIo}:{settlementTransport});
      providerServers.set(name,provider.server);providerStores.set(name, provider.store);if(name==='payments')paymentInstance=provider;
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
    // Provider/broker proofs need no browser bundle; building one is skipped for armed automation runs.
    if (!options.automation) {
    const web = join(dir, 'web'); await mkdir(web);
    console.log('Building an isolated React demo (live model calls disabled)…');
    await new Promise<void>((done, fail) => {
      // Windows runs npm through its command shim, which spawn only reaches through a shell.
      const windows = process.platform === 'win32';
      const child = spawn(windows ? 'npm.cmd' : 'npm', ['run', 'build', '--workspace', 'apps/shell-react', '--', '--outDir', web], {
        env: { ...process.env, VITE_GATEWAY_URL: coreUrl }, stdio: ['ignore', 'pipe', 'pipe'], shell: windows,
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
    }
    const { PaymentResourceUses } = await import('../../services/provider-simulator/src/payment-resource-uses.ts');
    const { ProviderPayables } = await import('../../services/provider-simulator/src/payables.ts');
    const restartPayments=async()=>{
      assert.ok(paymentInstance);const old=paymentInstance;await new Promise<void>(done=>{old.server.closeAllConnections();old.server.close(()=>done());});old.store.close();servers.splice(servers.indexOf(old.server),1);databases.splice(databases.indexOf(old.store.db),1);
      const next=createProviderServer('payments',join(dir,'payments.sqlite'),{authorizationClock:options.authorizationClock,paymentClient,issuerScenario,automationRun,automationIo});paymentInstance=next;providerStores.set('payments',next.store);databases.push(next.store.db);await listen(next.server,corePort+107);
    };
    const assertPaymentSource=(provider:string)=>assert.ok(['dewa','etisalat','du','police','rta'].includes(provider));
    return { appUrl, coreUrl, corePort, cleanup,
      pauseProvider:async(name:string)=>{const server=providerServers.get(name);assert.ok(server);server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));},
      resumeProvider:async(name:string)=>{const server=providerServers.get(name);assert.ok(server);const port=corePort+101+providerIds.indexOf(name as import('../../services/provider-simulator/src/contracts.ts').ProviderId);await new Promise<void>(done=>server.listen(port,'127.0.0.1',done));},
      failNextPaymentPreparation:(provider:string)=>{assertPaymentSource(provider);failedPreparations.add(provider);},
      loseNextReversalResponse:(provider:string)=>{assertPaymentSource(provider);lostReversals.add(provider);},
      holdSourceReads:(provider:string,hold:boolean)=>{assertPaymentSource(provider);if(hold)blockedSourceReads.add(provider);else blockedSourceReads.delete(provider);},issuerRunId:issuerScenario?.runId,automationRunId:automationRun?.runId,providerStores,restartPayments,holdLegacyAcknowledgement:(provider:string,hold:boolean)=>{assert.ok(['rta','dewa','etisalat','du','police'].includes(provider));if(hold)heldAcknowledgements.add(provider);else heldAcknowledgements.delete(provider);},receivedPaymentEvents:(account:string)=>providerStores.get('payments')!.db.prepare('SELECT id,disposition FROM payment_event_inbox WHERE account_id=? ORDER BY rowid').all(account).map(r=>({id:String(r.id),disposition:String(r.disposition)})),paymentEventRecords:(provider:string,account:string)=>providerStores.get(provider)!.db.prepare('SELECT body FROM payment_event_outbox WHERE account_id=? ORDER BY rowid').all(account).map(row=>JSON.parse(String(row.body)) as import('../../packages/protocol-core/src/payment-events.ts').PaymentEvent),loseNextSettlementResponse:(provider:string)=>{assert.ok(['dewa','etisalat','du','police','rta'].includes(provider));lostSettlementResponses.add(provider);},providerState: (provider: string, account: string, kind: string) => providerStores.get(provider)?.get(account, kind),
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
