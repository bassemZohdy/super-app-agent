/** Local synthetic demo operator. Never exposes management credentials to the browser. */
import { ClientCredentials } from '../packages/backend-kit/src/oauth.ts';
const [command,accountId,expected,requestKey,...reasonParts]=process.argv.slice(2);
if(!command||command==='--help'){
  console.log('npm run demo:payment-access -- inspect ACCOUNT\nnpm run demo:payment-access -- disable-owner|enable-owner|revoke-membership|restore-membership ACCOUNT EXPECTED_VERSION STABLE_REQUEST_KEY REASON');
}else{
  if(process.env.NODE_ENV==='production')throw Error('This operator is for the local synthetic demo only.');
  const operations:Record<string,{kind:'OWNER'|'MEMBERSHIP';enabled:boolean}>={'disable-owner':{kind:'OWNER',enabled:false},'enable-owner':{kind:'OWNER',enabled:true},'revoke-membership':{kind:'MEMBERSHIP',enabled:false},'restore-membership':{kind:'MEMBERSHIP',enabled:true}};
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(accountId||'')||command!=='inspect'&&!operations[command])throw Error('Use --help for the exact operator syntax.');
  const base=new URL(process.env.PROVIDER_PAYMENTS_URL||'http://localhost:4107');
  process.env.KEYCLOAK_ISSUER ||= 'http://localhost:8085/realms/superapp';
  const tokenUrl=new URL(process.env.KEYCLOAK_TOKEN_URL||`${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/token`);
  for(const u of [base,tokenUrl])if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||!['http:','https:'].includes(u.protocol))throw Error('Use loopback demo payment and identity endpoints only.');
  const credentials=new ClientCredentials('eligibility-operator',process.env.ELIGIBILITY_OPERATOR_SECRET||'demo-eligibility-operator-secret');
  const change=operations[command],reason=reasonParts.join(' '),version=Number(expected);
  if(change&&(!Number.isInteger(version)||version<1||version>1000000||!/^\d+$/.test(expected||'')||!/^[A-Za-z0-9_-]{8,100}$/.test(requestKey||'')||reason.length<5||reason.length>160||/[\r\n]/.test(reason)))throw Error('A current expected version, stable 8–100 character request key and 5–160 character reason are required.');
  const response=await fetch(new URL(`/internal/${change?'account-eligibility':'account-lifecycle'}/${accountId}`,base),{method:change?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${await credentials.token()}`,'Content-Type':'application/json',...(change?{'Idempotency-Key':requestKey}:{})},...(change?{body:JSON.stringify({...change,expectedVersion:version,reason})}:{})});
  const result=await response.json() as {success?:boolean;code?:string};
  if(!response.ok||result.success!==true)throw Error(`Operator request denied (${response.status}, ${String(result.code||'UNAVAILABLE').slice(0,80)}). Inspect the current version before a new decision; keep the original key for an uncertain outcome.`);
  console.log(JSON.stringify(result,null,2));
}
