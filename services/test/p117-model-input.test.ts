import test from 'node:test';
import assert from 'node:assert/strict';
import { minimiseHistory, minimiseSurface, minimiseText, modelConsentFor, scrubText, REDACTED, WITHHELD } from '../agent-core/src/model-input.ts';
import { invokeConversationModel } from '../agent-core/src/conversation-model.ts';

// One value per excluded class. Each is built from parts so no real-looking literal sits in the source.
const RAW = {
  emiratesId: ['784', '1990', '1234567', '1'].join('-'),
  card: ['4111', '1111', '1111', '1111'].join(' '),
  email: 'resident.name' + '@example.test',
  phone: '+971' + ' 50 123 4567',
  localPhone: '050' + ' 123 4567',
  uuid: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
  account: 'acct_' + '9f3a7c21d4',
  fineId: 'FINE-' + 'abc12345-0',
  meter: '4' + '5600123456',
  receipt: 'RCPT-' + '20261026-0042',
};

test('P1-17: every excluded identifier class is redacted from text', () => {
  for (const [name, value] of Object.entries(RAW)) {
    const out = scrubText(`Details for ${value} are on file.`);
    assert.equal(out.includes(value), false, `${name} must not survive`);
    assert.match(out, /\[redacted\]/, name);
  }
});

test('P1-17: amounts, dates, statuses and plan names are not mistaken for identifiers', () => {
  const kept = 'Total AED 1,500.00 · Fees AED 0.00 · expires 2026-10-26 · UNPAID · plan home_299 · Wi-Fi 6 · COVID-19 notice';
  assert.equal(scrubText(kept), kept);
});

test('P1-17: without consent every number is withheld, with consent amounts stay', () => {
  const text = 'Balance AED 1,500.00 on 2026-10-26, account ' + RAW.account;
  const shared = minimiseText(text, { personalContext: true }), withheld = minimiseText(text, { personalContext: false });
  assert.match(shared, /1,500\.00/);
  assert.equal(shared.includes(RAW.account), false, 'identifiers are excluded even with consent');
  assert.equal(/\d/.test(withheld), false, 'no digit survives without consent');
  assert.match(withheld, new RegExp(WITHHELD.replace(/[[\]]/g, '\\$&')));
});

const surface = () => ({
  type: 'SurfaceCard', id: `card_${RAW.account}`, properties: { title: 'Wallet', accountNumber: RAW.meter, cardNumber: RAW.card, ledger: [RAW.receipt] },
  children: [
    { type: 'Heading', id: 'h', properties: { text: 'Your wallet' } },
    { type: 'MetricWidget', id: 'm', properties: { label: 'Balance', value: 'AED 1,500.00', trend: 'up', raw: RAW.emiratesId } },
    { type: 'Text', id: 't', properties: { text: `Funding target ${RAW.account}, contact ${RAW.email} or ${RAW.phone}` } },
    { type: 'MapViewer', id: 'map', properties: { center: { lat: 25.2048, lng: 55.2708 }, label: 'Pickup' } },
    { type: 'ChoiceGroup', id: 'c', properties: { options: [{ id: RAW.uuid, label: `Card ${RAW.card}`, secret: RAW.meter }, { id: 'x', label: 'Wallet' }] } },
  ],
});

test('P1-17: the surface keeps structure, drops unknown properties and ids, and leaks no raw value with or without consent', () => {
  for (const personalContext of [true, false]) {
    const json = JSON.stringify(minimiseSurface(surface(), { personalContext }));
    for (const [name, value] of Object.entries(RAW)) assert.equal(json.includes(value), false, `${name} (consent ${personalContext})`);
    for (const dropped of ['accountNumber', 'cardNumber', 'ledger', 'raw', 'secret', 'center', 'lat', '"id"']) assert.equal(json.includes(dropped), false, dropped);
    for (const kept of ['SurfaceCard', 'Heading', 'MetricWidget', 'Balance', 'Wallet', 'up', 'Pickup']) assert.match(json, new RegExp(kept));
  }
  assert.match(JSON.stringify(minimiseSurface(surface(), { personalContext: true })), /1,500\.00/);
  assert.equal(/\d/.test(JSON.stringify(minimiseSurface(surface(), { personalContext: false }))), false, 'no number without consent');
});

test('P1-17: the minimiser returns a new tree and never edits the surface streamed to the resident', () => {
  const original = surface(), before = JSON.stringify(original);
  minimiseSurface(original, { personalContext: false });
  assert.equal(JSON.stringify(original), before);
});

test('P1-17: depth and node counts are bounded', () => {
  let deep: any = { type: 'Text', properties: { text: 'leaf' } };
  for (let i = 0; i < 40; i++) deep = { type: 'SurfaceCard', children: [deep] };
  assert.ok(JSON.stringify(minimiseSurface(deep, { personalContext: true })).length < 2000);
  const wide = { type: 'SurfaceCard', children: Array.from({ length: 1000 }, () => ({ type: 'Text', properties: { text: 'x' } })) };
  assert.ok((minimiseSurface(wide, { personalContext: true }) as any).children.length <= 200);
});

test('P1-17: consent is read from the session on every call, so a withdrawal applies to the next one', () => {
  const state: { metadata?: Record<string, unknown> } = { metadata: {} };
  assert.equal(modelConsentFor(state).personalContext, true);
  state.metadata!.modelPersonalContext = false;
  assert.equal(modelConsentFor(state).personalContext, false);
  state.metadata!.modelPersonalContext = true;
  assert.equal(modelConsentFor(state).personalContext, true);
  assert.equal(modelConsentFor({}).personalContext, true);
});

test('P1-17: the model request body carries no raw identifier whatever the caller sent', async t => {
  const previous = process.env.ENABLE_LOCAL_LLM;
  process.env.ENABLE_LOCAL_LLM = 'true';
  t.after(() => { if (previous === undefined) delete process.env.ENABLE_LOCAL_LLM; else process.env.ENABLE_LOCAL_LLM = previous; });
  const bodies: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: { body: string }) => { bodies.push(init.body); return Response.json({ choices: [{ message: { content: 'ok' } }] }); });
  const everything = Object.values(RAW).join(' | ');
  await invokeConversationModel([{ role: 'system', content: `Context: ${everything}` }, { role: 'user', content: `My details: ${everything}` }, { role: 'assistant', content: `Noted ${everything}` }, { role: 'user', content: 'Thanks' }]);
  assert.equal(bodies.length, 1);
  for (const [name, value] of Object.entries(RAW)) assert.equal(bodies[0].includes(value), false, `${name} reached the model request`);
  assert.match(bodies[0], new RegExp(REDACTED.replace(/[[\]]/g, '\\$&')));
});

test('P1-17: earlier assistant turns follow the consent, and the resident\'s own words keep their numbers', () => {
  const history = [
    { role: 'user', content: 'Please pay 50 AED, my email is a.b@example.test' },
    { role: 'assistant', content: 'Your wallet balance is 1500.00 AED and the fine FINE-00f4d533-0 is due on 2026-11-02.' },
  ];
  const shared = minimiseHistory(history, { personalContext: true });
  assert.equal(shared[0].content, `Please pay 50 AED, my email is ${REDACTED}`, 'identifiers are scrubbed from the resident\'s words');
  assert.equal(shared[1].content, `Your wallet balance is 1500.00 AED and the fine ${REDACTED} is due on 2026-11-02.`);
  const withheld = minimiseHistory(history, { personalContext: false });
  assert.match(withheld[0].content, /Please pay 50 AED/, 'what the resident typed is not withheld');
  assert.equal(withheld[1].content, `Your wallet balance is ${WITHHELD} AED and the fine ${REDACTED} is due on ${WITHHELD}`);
  assert.equal(minimiseHistory([{ role: 'assistant', content: 'x'.repeat(9000) }], { personalContext: true }, 100)[0].content.length, 100, 'bounded');
});
