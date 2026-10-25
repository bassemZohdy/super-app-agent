import { shutdownOnSignal } from '../../../packages/backend-kit/src/shutdown.ts';
import { durableWork } from '../../../packages/backend-kit/src/operations-state.ts';
import { Telemetry,correlation } from '../../../packages/backend-kit/src/observability.ts';
import { ObligationError } from './payment-obligations.ts';
import { EligibilityError } from './account-eligibility.ts';
import { EligibilityClient } from '../../../packages/backend-kit/src/eligibility-client.ts';
import { eligibilityChangeSchema,type EligibilityChange } from '../../../packages/protocol-core/src/account-eligibility.ts';
import { MandateError } from './payment-mandates.ts';
import { verifyMandateTarget } from './mandate-targets.ts';
import { issuerScenarioSchemas } from '../../../packages/protocol-core/src/issuer-scenarios.ts';
import { IssuerScenarioError,type IssuerScenarioContext } from './issuer-scenarios.ts';
import { AutomationRunError,automationRunSchemas } from './automation-runs.ts';
import { ScenarioControlError, scenarioArmSchema } from './scenario-controls.ts';
import { inspectRun } from './run-inspector.ts';
import { startPaymentEventDelivery } from './payment-events.ts';
import type { PaymentEvent } from '../../../packages/protocol-core/src/payment-events.ts';
import { PaymentResourceError } from './payment-resource-uses.ts';
import { PayableError } from './payables.ts';
import { PaymentOrderError } from './payment-orders.ts';
import { IssuerError } from './payment-issuer.ts';
import { claimantFor,settlementProviders,SettlementError,type SettlementProvider } from './payment-claims.ts';
import { SettlementClient,type ClaimTransport } from './settlement-client.ts';
import { ProviderSettlements } from './provider-settlements.ts';
import { PaymentCheckout } from './payment-checkout.ts';
import { PaymentLedgerError } from './payment-ledger.ts';
import { verifyBillerReference } from './payment-ownership.ts';
import { PaymentRegistryError } from './payment-registry.ts';
import { HttpPolicy, HttpError, readJsonBody } from '../../../packages/backend-kit/src/http-policy.ts';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { verifyJwt } from '../../../packages/backend-kit/src/jwt.ts';
import { ProviderClient, UpstreamError } from '../../../packages/backend-kit/src/provider-client.ts';
import { authorizeDelegatedProvider } from '../../../packages/backend-kit/src/delegation.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import { AccountDatabase } from './database.ts';
import { ProviderEngine, ApiError, type ApiResult } from './engine.ts';
import { operations, openApi, providerIds, type ProviderId } from './contracts.ts';
export const callers: Record<ProviderId, string[]> = { rta: ['service-ride','service-catalog','service-wallet'], dewa: ['service-food','service-wallet','service-catalog'], etisalat: ['service-telecom'], du: ['service-telecom'], police: ['service-wallet'], dld: ['service-catalog'], payments: ['service-wallet','service-food','service-ride','service-telecom','provider-settlements'] };
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export function createProviderServer(provider: ProviderId, path: string, options:{authorizationClock?:()=>number;settlementTransport?:ClaimTransport;paymentClient?:ProviderClient;issuerScenario?:IssuerScenarioContext}={}) {
  const store = new AccountDatabase(path), engine = new ProviderEngine(provider, store,options);
  const ajv = new Ajv({ strict: false, allErrors: true });
  const routes = operations[provider].map(operation => ({ ...operation, regex: new RegExp(`^${operation.path.replace(/\{\w+\}/g, '[^/]+')}$`), validate: operation.body ? ajv.compile(operation.body) : undefined }));
  const payments = options.paymentClient||new ProviderClient('provider-settlements', process.env.PROVIDER_SETTLEMENT_SECRET || 'demo-settlements-secret');
  const settlements=settlementProviders.includes(provider as SettlementProvider)?new ProviderSettlements(store,provider as SettlementProvider,options.settlementTransport||new SettlementClient(provider as SettlementProvider)):undefined;
  const eligibilityReader=new EligibilityClient(),validateEligibility=ajv.compile<EligibilityChange>(eligibilityChangeSchema);
  const checkout=engine.orders?new PaymentCheckout(engine.orders,payments):undefined;
  const policy = new HttpPolicy();
  const telemetry=new Telemetry(provider).durable(()=>durableWork(store.db));
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 }, telemetry.handler(async (req, res) => {
    const suppliedRequestId = req.headers['x-request-id'];
    const requestId = correlation()?.requestId || (typeof suppliedRequestId === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(suppliedRequestId) ? suppliedRequestId : randomUUID());
    const send = (result: ApiResult) => { res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-Id': requestId }); res.end(JSON.stringify(result.data)); };
    try {
      const release = policy.admit(req.socket.remoteAddress || 'unknown'); res.once('finish', release); res.once('close', release);
      const url = new URL(req.url || '/', 'http://provider');
      if (req.method === 'GET' && url.pathname === '/health') return send({ status: 200, data: { status: 'ok', provider, storage: 'sqlite' } });
      if (req.method === 'GET' && url.pathname === '/openapi.json') return send({ status: 200, data: openApi(provider,store.issuerScenarios?.context.runId) });
      if(provider==='payments'&&req.method==='POST'&&url.pathname==='/internal/payment-events'&&!url.search){
        const event=await readJsonBody(req) as PaymentEvent;
        const header=(name:string)=>typeof req.headers[name]==='string'?req.headers[name] as string:'';
        const result=store.events!.receive(event,{source:header('x-payment-event-source'),kid:header('x-payment-event-key'),timestamp:header('x-payment-event-time'),nonce:header('x-payment-event-nonce'),signature:header('x-payment-event-signature')});return send({status:200,data:{success:true,...result}});
      }
      const claims = await verifyJwt(req.headers.authorization, 'provider-api').catch(() => { throw new ApiError(401, 'UNAUTHENTICATED', 'A valid service access token is required.'); });
      const roles = claims.realm_access?.roles || [];
      const delegated = claims.azp === 'delegation-broker';
      const interactive = claims.azp === 'superapp-shell' && roles.includes('superapp-user') && !String(claims.preferred_username || '').startsWith('service-account-');
      const eligibilityPath=/^\/internal\/(account-eligibility|account-lifecycle)\/([A-Za-z0-9_-]{1,160})$/.exec(url.pathname);
      if(provider==='payments'&&eligibilityPath&&!url.search){
        const machine=!interactive&&!delegated&&claims.act===undefined&&String(claims.preferred_username||'').startsWith('service-account-');
        const reader=machine&&claims.azp==='provider-eligibility'&&roles.includes('provider:eligibility:read'),operator=machine&&claims.azp==='eligibility-operator'&&roles.includes('provider:eligibility:manage');
        if(!reader&&!operator)throw new ApiError(403,'ELIGIBILITY_WORKLOAD_REQUIRED','Only the exact eligibility reader/operator workload may use this lane.');
        const [,kind,account]=eligibilityPath;if(req.method==='GET'&&kind==='account-eligibility')return send({status:200,data:{success:true,eligibility:store.eligibility!.snapshot(account)}});
        if(req.method==='GET'&&kind==='account-lifecycle'&&operator)return send({status:200,data:{success:true,...store.eligibility!.impact(account)}});
        if(req.method==='POST'&&kind==='account-eligibility'&&operator){const input=await readJsonBody(req);if(!validateEligibility(input))throw new ApiError(400,'VALIDATION_ERROR','Use the exact versioned eligibility decision.');const key=req.headers['idempotency-key'];if(typeof key!=='string')throw new ApiError(400,'IDEMPOTENCY_REQUIRED','An operator request key is required.');return send({status:200,data:{success:true,eligibility:store.eligibility!.change(account,input,claims.sub,key)}});}
        throw new ApiError(403,'ELIGIBILITY_OPERATION_DENIED','This workload cannot change or inspect this eligibility operation.');
      }
      const controlRoute=/^\/internal\/scenario-controls\/(simrun_[a-f0-9-]{36})(?:\/(arm|clear|inspect))?$/.exec(url.pathname);
      if(url.pathname.startsWith('/internal/scenario-controls/')){
        const controls=store.scenarioControls;
        if(!controls||!controlRoute||url.search||controlRoute[1]!==controls.run.context.runId)throw new ApiError(404,'SCENARIO_CONTROLS_NOT_FOUND','No scenario controls are installed for this run.');
        if(!interactive||claims.act!==undefined)throw new ApiError(403,'SCENARIO_OPERATOR_REQUIRED','A signed interactive run operator is required.');
        if(req.method==='GET'&&!controlRoute[2])return send({status:200,data:{success:true,...controls.status(claims.sub)}});
        if(req.method==='GET'&&controlRoute[2]==='inspect'){
          const view=inspectRun(engine.store,{orders:engine.orders!,ledger:engine.ledger!,issuer:engine.issuer,claims:engine.claims,
            methods:(accountId:string)=>engine.store.list(accountId,'payment-method') as {id:string;kind:string;status:string}[]});
          return send({status:200,data:{success:true,...view}});
        }
        if(req.method==='POST'&&controlRoute[2]==='arm'){
          const input=await readJsonBody(req);
          if(!ajv.validate(scenarioArmSchema,input))throw new ApiError(400,'VALIDATION_ERROR','Arm a named failpoint with a bounded count and operator key.');
          return send({status:200,data:{success:true,...controls.arm(claims.sub,input as {name:string;times?:number;requestKey:string})}});
        }
        if(req.method==='POST'&&controlRoute[2]==='clear')return send({status:200,data:{success:true,...controls.clear(claims.sub)}});
        throw new ApiError(404,'SCENARIO_CONTROLS_NOT_FOUND','Unknown scenario control operation.');
      }
      const automationRoute=/^\/internal\/automation-runs\/(autorn_[a-f0-9-]{36})(?:\/(prepare|execution\/([A-Za-z0-9_-]+)))?$/.exec(url.pathname);
      if(url.pathname.startsWith('/internal/automation-runs/')){
        const runs=store.automationRuns;
        if(!runs||!automationRoute||url.search||automationRoute[1]!==runs.context.runId)throw new ApiError(404,'AUTOMATION_RUN_NOT_FOUND','No automatic execution run is installed here.');
        // The dedicated worker service account may only read a prepared execution; everything else needs the signed-in run operator.
        const worker=!interactive&&!delegated&&claims.act===undefined&&claims.azp==='automation-worker'&&String(claims.preferred_username||'').startsWith('service-account-')&&String(claims.scope||'').split(' ').includes('automation.execute');
        if(worker&&req.method==='GET'&&automationRoute[2]==='execution')return send({status:200,data:{success:true,execution:runs.readExecution(claims.sub,automationRoute[3] as string)}});
        if(!interactive||claims.act!==undefined)throw new ApiError(403,'AUTOMATION_ROLE_REQUIRED','A signed interactive run identity is required.');
        if(req.method==='GET'&&!automationRoute[2]){return send({status:200,data:{success:true,...runs.status(claims.sub)}});}
        if(req.method==='POST'&&automationRoute[2]==='prepare'){
          const input=await readJsonBody(req);
          if(!ajv.validate(automationRunSchemas.prepare,input))throw new ApiError(400,'VALIDATION_ERROR','The preparation request has invalid or unsupported fields.');
          const result=runs.prepare(claims.sub,input as {mandateId:string;occurrenceKey:string;requestKey:string});
          return send({status:200,data:{success:true,...result}});
        }
        throw new ApiError(404,'AUTOMATION_RUN_NOT_FOUND','Unknown automation run operation.');
      }
      const scenarioRoute=/^\/internal\/issuer-scenarios\/(simrun_[a-f0-9-]{36})(?:\/(configuration|pending))?$/.exec(url.pathname);
      if(url.pathname.startsWith('/internal/issuer-scenarios/')){
        const scenarios=store.issuerScenarios;
        if(!scenarios||!scenarioRoute||url.search||scenarioRoute[1]!==scenarios.context.runId)throw new ApiError(404,'SCENARIO_NOT_FOUND','No issuer controls are installed for this run.');
        if(!interactive||claims.act!==undefined)throw new ApiError(403,'SCENARIO_OPERATOR_REQUIRED','A signed interactive run operator is required.');scenarios.operator(claims.sub);
        if(req.method==='GET'&&!scenarioRoute[2])return send({status:200,data:{success:true,...scenarios.status(claims.sub)}});
        if(req.method==='POST'&&['configuration','pending'].includes(scenarioRoute[2])){
          const input=await readJsonBody(req),schema=issuerScenarioSchemas[scenarioRoute[2] as keyof typeof issuerScenarioSchemas];
          if(!ajv.validate(schema,input))throw new ApiError(400,'VALIDATION_ERROR','The run configuration has invalid or unsupported fields.');
          if(scenarioRoute[2]==='configuration')return send({status:200,data:{success:true,...scenarios.configure(claims.sub,input as Parameters<typeof scenarios.configure>[1])}});
          const pending=input as {accountId:string;orderId:string;decision:'APPROVE'|'DECLINE';requestKey:string};return send({status:200,data:{success:true,authorization:engine.issuer!.resolvePending(claims.sub,pending.accountId,pending.orderId,pending.decision,pending.requestKey)}});
        }
        throw new ApiError(404,'SCENARIO_NOT_FOUND','Unknown issuer run operation.');
      }
      const claimRoute=provider==='payments'&&req.method==='POST'&&/^\/v1\/accounts\/[A-Za-z0-9_-]+\/charges\/[^/]+\/settlement\/(claim|ack|release)$/.test(url.pathname);
      const claimant=claimRoute&&!interactive&&!delegated?claimantFor({azp:claims.azp,realm_access:claims.realm_access}):undefined;
      if (claims.act !== undefined) throw new ApiError(403, 'ACTOR_CHAIN_UNSUPPORTED', 'Caller supplied or unsupported actor chains are not accepted.');
      if (!delegated && !interactive && !claimant && (!callers[provider].includes(claims.azp) || !(roles.includes(`provider:${provider}`) || (req.method === 'GET' && roles.includes(`provider:${provider}:read`))))) throw new ApiError(403, 'SERVICE_FORBIDDEN', 'This service is not allowed to use this provider.');
      if (!delegated && !interactive && !claimant && (process.env.DELEGATION_ENABLED === 'true' || process.env.NODE_ENV === 'production') && !(claims.azp === 'provider-settlements' && provider === 'payments' && req.method === 'GET' && /^\/v1\/accounts\/[a-zA-Z0-9_-]+\/charges\/[a-zA-Z0-9_-]+$/.test(url.pathname))) throw new ApiError(403, 'USER_TOKEN_REQUIRED', 'Service credentials cannot impersonate a human on this endpoint.');
      // The narrow settlement lane derives the owner from existing gateway state; it never trusts a human header or creates an account.
      const claimAccount=claimant?store.db.prepare('SELECT owner FROM accounts WHERE id=?').get(url.pathname.split('/')[3]):undefined;
      if(claimant&&!claimAccount)throw new ApiError(404,'ACCOUNT_NOT_FOUND','Settlement account not found.');
      const subject = claimant?String(claimAccount!.owner):delegated || interactive ? claims.sub : req.headers['x-user-subject'];
      if (typeof subject !== 'string' || !subject || subject.length > 200 || /[\r\n\x00-\x1f]/.test(subject)) throw new ApiError(400, 'ACTOR_REQUIRED', 'A trusted user subject is required.');
      const accounts = claimant?[]:store.accounts(subject);
      if (req.method === 'GET' && url.pathname === '/v1/accounts' && !delegated) return send({ status: 200, data: { success: true, accounts:provider==='payments'?accounts.map(a=>({...a,eligibility:store.eligibility!.snapshot(a.id)})):accounts } });
      const match = /^\/v1\/accounts\/([a-zA-Z0-9_-]+)(\/.*)$/.exec(url.pathname);
      if (!match) throw new ApiError(404, 'NOT_FOUND', 'Operation not found.');
      const [, accountId, operationPath] = match;
      if (!store.owns(subject, accountId)) throw new ApiError(403, 'ACCOUNT_FORBIDDEN', 'This account does not belong to the user.');
      const operation = routes.find(route => route.method === req.method && route.regex.test(operationPath));
      if (!operation || url.search) throw new ApiError(404, 'NOT_FOUND', 'Operation not found.');
      if(claimRoute&&!claimant)throw new ApiError(403,'CLAIM_CLIENT_REQUIRED','Only the exact provider settlement workload can change a claim.');
      if(provider==='payments'&&(operationPath==='/payment-lifecycle'||operationPath.startsWith('/payment-history')||operationPath.startsWith('/payment-statement')||operationPath.startsWith('/payment-reconciliation')||operationPath.startsWith('/payment-mandates')||operationPath.startsWith('/payment-orders')||operationPath.startsWith('/wallet-funding-orders')||operationPath.startsWith('/checkout-groups')||operationPath.startsWith('/payment-refunds')||operationPath==='/payment-events')&&!interactive)throw new ApiError(403,'INTERACTIVE_REVIEW_REQUIRED','Stored authorization reviews require the signed-in owner. Unattended actors cannot approve or answer challenges.');
      if((operationPath.includes('/admissions')||operationPath==='/fine-selections'||operationPath==='/recharge-quotes'||operationPath.startsWith('/payment-reversals/'))&&!interactive)throw new ApiError(403,'INTERACTIVE_ADMISSION_REQUIRED','Payable admission requires the current signed-in owner.');
      const actor: Actor = { sub: subject, username: subject, name: typeof req.headers['x-user-name'] === 'string' ? Buffer.from(req.headers['x-user-name'], 'base64url').toString('utf8').slice(0, 200) : 'Demo citizen', accountId, requestId: '', authorization: interactive ? req.headers.authorization : undefined };
      if(provider==='payments'&&req.method==='GET'&&operationPath==='/account-eligibility'&&interactive)return send({status:200,data:{success:true,eligibility:store.eligibility!.snapshot(accountId)}});
      // Settlement claim/proof lanes retain original captured identities; they cannot admit a new charge.
      const retainedSettlement=claimant||claims.azp==='provider-settlements'&&provider==='payments'&&req.method==='GET'&&/^\/charges\/[A-Za-z0-9_-]+$/.test(operationPath);
      if(!retainedSettlement&&(process.env.ELIGIBILITY_ENFORCEMENT==='true'||process.env.NODE_ENV==='production')){
        let eligibility;
        try{eligibility=provider==='payments'?store.eligibility!.snapshot(accountId):await eligibilityReader.bootstrap({...actor,authorization:interactive?req.headers.authorization:undefined});}
        catch{throw new ApiError(503,'ELIGIBILITY_UNAVAILABLE','Current account eligibility is unavailable; no new authority is admitted.');}
        if(!eligibility.active||eligibility.ownerSub!==subject)throw new ApiError(403,'ACCOUNT_RESTRICTED','Current owner or workspace membership prevents access. History is retained.');actor.eligibilityEpoch=eligibility.epoch;
      }
      let body: any = {};
      if (req.method === 'POST') {
        body = await readJsonBody(req);
        if (!operation.validate?.(body)) throw new ApiError(400, 'VALIDATION_ERROR', 'The request does not match the OpenAPI schema.');
      }
      if (delegated) {
        if (process.env.DELEGATION_ENABLED !== 'true') throw new ApiError(403, 'DELEGATION_DISABLED', 'Delegated requests are disabled.');
        try { await authorizeDelegatedProvider(req.headers.authorization, provider, accountId, req.method || 'GET', operationPath, body); }
        catch { throw new ApiError(403, 'DELEGATION_DENIED', 'The current grant does not permit this exact operation.'); }
      }
      if(!claimant)engine.seed(actor);
      const rawKey=req.headers['idempotency-key'];
      const key=claimant&&typeof rawKey==='string'?`claim:${claimant}:${rawKey}`:rawKey;
      const fingerprint = createHash('sha256').update(JSON.stringify([req.method, operationPath, canonical(body),...(claimant?[claimant]:[])])).digest('hex');
      if (req.method === 'POST') {
        if (typeof rawKey !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(rawKey)) throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'Provide an Idempotency-Key of 1 to 200 ASCII characters.');
        engine.refunds?.reserveRequest(accountId,key as string,fingerprint);
        const existing = store.db.prepare('SELECT fingerprint,status,body FROM idempotency WHERE account_id=? AND key=?').get(accountId, key as string) as any;
        if (existing) { if (existing.fingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with a different request.');if(!claimant){if(body.paymentId&&settlements)await settlements.retryConfirmation(accountId,body.paymentId);return send({ status: existing.status, data: JSON.parse(existing.body) });} }
      }
      // A delegated write with external payment proof is outside the initial bounded write profile.
      if (delegated && body.paymentId) throw new ApiError(403, 'WRITE_NOT_APPROVED', 'Delegated settlement is not enabled.');
      if(provider==='payments'&&operationPath==='/charges'&&(['dewa','etisalat','du'].includes(body.merchant)&&/^(bill|prepaid|recharge|payable|admission):/.test(body.reference)||body.merchant==='police'&&/^(fines|payable|admission):/.test(body.reference)||body.merchant==='rta'&&/^(salik|payable|admission):/.test(body.reference)))throw new ApiError(409,'STORED_BILL_ORDER_REQUIRED','Bill/fine captures now require an approved stored order; use the payment-order execution API.');
      if(engine.reconciliation&&req.method==='POST'&&(operationPath==='/payment-reconciliation/inspect'||/^\/payment-reconciliation\/inspections\/[^/]+\/act$/.test(operationPath))){
        const inspection=operationPath.endsWith('/inspect')?await engine.reconciliation.inspect(actor,body.kind,body.operationId,payments):await engine.reconciliation.act(actor,operationPath.split('/')[3],body,payments,(a,id)=>engine.execute(a,'POST',`/charges/${id}/refunds`,{reason:'Recovery of provider-confirmed non-application'}));
        const result={status:200,data:{success:true,inspection}};
        store.transaction(()=>{const previous=store.db.prepare('SELECT fingerprint FROM idempotency WHERE account_id=? AND key=?').get(accountId,key as string);if(previous&&previous.fingerprint!==fingerprint)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','This recovery request key has different terms.');store.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?) ON CONFLICT(account_id,key) DO NOTHING').run(accountId,key as string,fingerprint,200,JSON.stringify(result.data));});return send(result);
      }
      const refundAction=/^\/payment-refunds\/([^/]+)\/(execute|recover)$/.exec(operationPath);
      if(engine.refunds&&req.method==='POST'&&refundAction){
        const [,id,action]=refundAction;const refund=action==='execute'?await engine.refunds.execute(actor,id,body,payments):await engine.refunds.recover(actor,id,payments);
        const result={status:200,data:{success:true,refund}};
        store.transaction(()=>{const previous=store.db.prepare('SELECT fingerprint FROM idempotency WHERE account_id=? AND key=?').get(accountId,key as string);if(previous&&previous.fingerprint!==fingerprint)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','This refund request has different terms.');store.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?) ON CONFLICT(account_id,key) DO NOTHING').run(accountId,key as string,fingerprint,200,JSON.stringify(result.data));});return send(result);
      }
      const groupAction=/^\/checkout-groups\/([^/]+)\/(approve|execute|cancel)$/.exec(operationPath);
      if(engine.groups&&checkout&&req.method==='POST'&&(operationPath==='/checkout-groups'||groupAction)){
        let result:ApiResult;
        if(operationPath==='/checkout-groups'){
          const snapshots=await Promise.all(body.items.map((item:{provider:string;payableId:string})=>payments.call(item.provider,actor,'GET',`/payables/${encodeURIComponent(item.payableId)}`).then(data=>data.payable)));
          result=store.transaction(()=>{
            const previous=store.db.prepare('SELECT fingerprint,status,body FROM idempotency WHERE account_id=? AND key=?').get(accountId,key as string);
            if(previous){if(previous.fingerprint!==fingerprint)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','This request key has different terms.');return {status:Number(previous.status),data:JSON.parse(String(previous.body))};}
            const data={success:true,group:engine.groups!.create(actor,body,snapshots)};
            store.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?)').run(accountId,key as string,fingerprint,200,JSON.stringify(data));return {status:200,data};
          });
        }else{
          const [,id,action]=groupAction!;
          const group=action==='approve'?engine.groups.approve(actor,id,body):action==='cancel'?await engine.groups.cancel(actor,id,body.expectedVersion,checkout):await engine.groups.execute(actor,id,body,checkout,payments);
          result={status:200,data:{success:true,group}};
          store.transaction(()=>{const previous=store.db.prepare('SELECT fingerprint FROM idempotency WHERE account_id=? AND key=?').get(accountId,key as string);if(previous&&previous.fingerprint!==fingerprint)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','This request key has different terms.');store.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?) ON CONFLICT(account_id,key) DO NOTHING').run(accountId,key as string,fingerprint,200,JSON.stringify(result.data));});
        }
        return send(result);
      }
      const checkoutAction=/^\/payment-orders\/([^/]+)\/(execute|recover|cancel)$/.exec(operationPath);
      if(checkout&&req.method==='POST'&&checkoutAction){
        const [,id,action]=checkoutAction;const order=action==='execute'?await checkout.execute(actor,id,body):action==='recover'?await checkout.recover(actor,id):await checkout.cancel(actor,id,body.expectedVersion);
        const result={status:200,data:{success:true,order}};
        store.transaction(()=>{const previous=store.db.prepare('SELECT fingerprint FROM idempotency WHERE account_id=? AND key=?').get(accountId,key as string);if(previous&&previous.fingerprint!==fingerprint)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','This request key has different terms.');store.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?) ON CONFLICT(account_id,key) DO NOTHING').run(accountId,key as string,fingerprint,200,JSON.stringify(result.data));});return send(result);
      }
      if (provider === 'payments' && req.method === 'POST' && operationPath === '/billing-accounts') await verifyBillerReference(payments, actor, body);
      if(engine.mandates&&req.method==='POST'&&(operationPath==='/payment-mandates'||/^\/payment-mandates\/[^/]+\/(revise|approve)$/.test(operationPath))){
        const policy=operationPath.endsWith('/approve')?engine.mandates.get(actor,operationPath.split('/')[2]).policy:body.policy;
        await verifyMandateTarget(payments,actor,policy);
      }
      let payableSnapshot:import('../../../packages/protocol-core/src/payments.ts').Payable|undefined;
      if(provider==='payments'&&req.method==='POST'&&(operationPath==='/payment-orders'||/^\/payment-orders\/[^/]+\/(approve|challenge)$/.test(operationPath))){
        const order=operationPath==='/payment-orders'?undefined:engine.orders!.get(actor,operationPath.split('/')[2]);
        const targetProvider=order?order.quote.payable.provider:body.provider,targetId=order?order.quote.payable.id:body.payableId;
        if(!['dewa','etisalat','du','police','rta'].includes(targetProvider))throw new ApiError(400,'INVALID_PROVIDER','Choose a supported obligation provider.');
        payableSnapshot=(await payments.call(targetProvider,actor,'GET',`/payables/${encodeURIComponent(targetId)}`)).payable;
      }
      let refundReview:import('../../../packages/protocol-core/src/payments.ts').PaymentRefund|undefined;
      if(engine.reversals&&req.method==='POST'&&/^\/payment-reversals\/[^/]+$/.test(operationPath))refundReview=(await payments.call('payments',actor,'GET',`/payment-refunds/${encodeURIComponent(operationPath.split('/')[2])}`)).refund;
      const proof = body.paymentId ? (await payments.call('payments', actor, 'GET', `/charges/${encodeURIComponent(body.paymentId)}`)).charge : undefined;
      let gatewayOrder:import('../../../packages/protocol-core/src/payments.ts').PaymentAuthorizationReview|undefined;
      const admissionAction=/^\/payables\/[^/]+\/admissions\/([^/]+)\/(admit|cancel|finish)$/.exec(operationPath);
      if(engine.admissions&&req.method==='POST'&&admissionAction){const admission=engine.admissions.get(accountId,admissionAction[1]);gatewayOrder=(await payments.call('payments',actor,'GET',`/payment-orders/${encodeURIComponent(admission.orderId)}`)).order;}
      if(settlements&&req.method==='GET'&&/^\/settlement-attempts\/[^/]+$/.test(operationPath)){
        const paymentId=operationPath.split('/')[2];const historical=store.get(accountId,'used-payment',paymentId)?(await payments.call('payments',actor,'GET',`/charges/${encodeURIComponent(paymentId)}`)).charge:undefined;
        return send({status:200,data:{success:true,settlement:await settlements.inspect(actor,paymentId,historical)}});
      }
      if(settlements&&proof)return send(await settlements.execute(actor,key as string,fingerprint,proof,claimedProof=>engine.execute(actor,req.method||'POST',operationPath,body,claimedProof,payableSnapshot,gatewayOrder)));
      const result = store.transaction(() => {
        // Re-check after asynchronous proof retrieval; another request may have committed.
        if (req.method === 'POST') {
          const existing = store.db.prepare('SELECT fingerprint,status,body FROM idempotency WHERE account_id=? AND key=?').get(accountId, key as string) as any;
          if (existing) { if (existing.fingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with a different request.');if(!claimant)return { status: existing.status, data: JSON.parse(existing.body) }; }
          if (proof && store.get(accountId, 'used-payment', proof.id)) throw new ApiError(409, 'PAYMENT_ALREADY_USED', 'This payment was already applied.');
        }
        const action=operationPath.split('/')[4],paymentId=operationPath.split('/')[2];
        const result:ApiResult=claimant?{status:200,data:{success:true,...(action==='claim'?engine.claims!.claim(accountId,paymentId,claimant,body):action==='ack'?engine.claims!.acknowledge(accountId,paymentId,claimant,body):engine.claims!.release(accountId,paymentId,claimant,body))}}:engine.execute(actor, req.method || 'GET', operationPath, body, proof,payableSnapshot,gatewayOrder,refundReview);
        if (req.method === 'POST') {
          if (proof && result.data.success) store.put(accountId, 'used-payment', true, proof.id);
          store.db.prepare('INSERT INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?) ON CONFLICT(account_id,key) DO UPDATE SET status=excluded.status,body=excluded.body').run(accountId, key as string, fingerprint, result.status, JSON.stringify(result.data));
        }
        return result;
      });
      send(result);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof ObligationError||error instanceof EligibilityError||error instanceof MandateError || error instanceof IssuerScenarioError || error instanceof AutomationRunError || error instanceof ScenarioControlError || error instanceof ApiError || error instanceof PaymentRegistryError || error instanceof PaymentLedgerError || error instanceof PaymentResourceError || error instanceof PayableError || error instanceof PaymentOrderError || error instanceof IssuerError || error instanceof UpstreamError || error instanceof SettlementError ? error.status : 503;
      res.setHeader('Connection', 'close');
      send({ status, data: { success: false, code: error instanceof ObligationError||error instanceof EligibilityError||error instanceof MandateError || error instanceof IssuerScenarioError || error instanceof AutomationRunError || error instanceof ScenarioControlError || error instanceof ApiError || error instanceof PaymentRegistryError || error instanceof PaymentLedgerError || error instanceof PaymentResourceError || error instanceof PayableError || error instanceof PaymentOrderError || error instanceof IssuerError || error instanceof UpstreamError || error instanceof SettlementError ? error.code : 'PROVIDER_UNAVAILABLE', error: error instanceof HttpError ? error.message : error instanceof ObligationError||error instanceof EligibilityError||error instanceof MandateError || error instanceof IssuerScenarioError || error instanceof AutomationRunError || error instanceof ScenarioControlError || error instanceof ApiError || error instanceof PaymentRegistryError || error instanceof PaymentLedgerError || error instanceof PaymentResourceError || error instanceof PayableError || error instanceof PaymentOrderError || error instanceof IssuerError || error instanceof UpstreamError || error instanceof SettlementError ? error.message : 'The simulator could not complete this request. Check operation status before retrying a write.' } });
    }
  },{identity:'provider',ready:()=>{store.db.prepare('SELECT 1').get();}}));
  server.once('close',()=>telemetry.close());
  let eventDelivery:ReturnType<typeof startPaymentEventDelivery>|undefined;
  server.once('listening',()=>{if(store.events)eventDelivery=startPaymentEventDelivery(store.events);});
  server.once('close',()=>eventDelivery?.stop());
  return { server, store };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const provider = process.env.PROVIDER_ID as ProviderId;
  if (!providerIds.includes(provider)) throw new Error('Set PROVIDER_ID to a supported provider.');
  const { server,store } = createProviderServer(provider, process.env.PROVIDER_DB_PATH || `./data/${provider}.sqlite`);
  const port = Number(process.env.PORT || 4101 + providerIds.indexOf(provider));
  shutdownOnSignal(server,()=>store.close());
  server.listen(port, '0.0.0.0', () => console.log(`${provider} simulator listening on ${port}`));
}
