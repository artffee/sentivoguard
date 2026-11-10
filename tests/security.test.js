const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const store = require('../lib/store');
const U = require('../lib/users');
const L = require('../server/license');
const B = require('../lib/billing');
const H = require('../lib/http');
const data = new Map();
const copy = value => value == null ? null : structuredClone(value);
store.get = async key => copy(data.get(key));
store.set = async (key, value) => { data.set(key, copy(value)); return true; };
store.create = async (key, value) => { if (data.has(key)) return false; data.set(key, copy(value)); return true; };
store.del = async key => data.delete(key);
store.release = async (key, owner) => data.get(key) === owner ? data.delete(key) : false;
store.take = async key => { const value = copy(data.get(key)); data.delete(key); return value; };
store.patch = async (key, fields) => { if (!data.has(key)) return null; const value = {...data.get(key), ...copy(fields)}; data.set(key,value); return copy(value); };
store.patchVersion = async (key, fields, version) => (data.get(key)?.sessionVersion || 0) === version ? store.patch(key, fields) : null;
store.limit = async (key, max) => { const count = (data.get(key) || 0) + 1; data.set(key,count); return count <= max; };
const keys = crypto.generateKeyPairSync('ed25519');
process.env.SG_LICENSE_PUBLIC_KEY = keys.publicKey.export({type:'spki',format:'pem'});
process.env.SG_LICENSE_PRIVATE_KEY = keys.privateKey.export({type:'pkcs8',format:'pem'});
Object.assign(process.env, {PUBLIC_ORIGIN:'https://sentivoguard.com', KV_REST_API_URL:'https://redis.invalid', KV_REST_API_TOKEN:'fixture',
  RESEND_API_KEY:'fixture', RESEND_FROM:'test@sentivoguard.com', STRIPE_SECRET_KEY:'rk_' + 'test_fixture', STRIPE_WEBHOOK_SECRET:'whsec_fixture', STRIPE_PRICE_STANDARD:'price_standard', STRIPE_PRICE_PLUS:'price_plus',
  STRIPE_PRICE_ULTIMATE:'price_ultimate', SG_BILLING_ENABLED:'true', SG_DOWNLOAD_ENABLED:'true', SG_DOWNLOAD_URL:'https://downloads.invalid/app.exe', SG_STRIPE_MODE:'test', STRIPE_PORTAL_CONFIGURATION:'bpc_fixture'});
beforeEach(() => data.clear());
async function account() { return U.signup('person@example.com','correct horse battery'); }
function req(body = {}, cookie = '') { return {method:'POST',headers:{origin:process.env.PUBLIC_ORIGIN,'content-type':'application/json',cookie},body,socket:{remoteAddress:'127.0.0.1'}}; }
async function invoke(handler, request) {
  const headers = {};
  let output;
  const response = {statusCode:200,setHeader:(k,v)=>headers[k.toLowerCase()]=v,getHeader:k=>headers[k.toLowerCase()],end:value=>output=value};
  await handler(request,response);
  return { status:response.statusCode,headers,body:output ? JSON.parse(output) : null };
}
function fakeStripe(user) {
  let calls = 0;
  const sub = {id:'sub_fixture',livemode:false,created:100,customer:'cus_fixture',status:'active',items:{data:[{price:{id:'price_plus'},quantity:1,current_period_end:2000000000}]},
    latest_invoice:{id:'in_fixture',status:'paid',parent:{subscription_details:{subscription:'sub_fixture'}},lines:{data:[{pricing:{price_details:{price:'price_plus'}},period:{end:2000000000}}]}}};
  const session = {id:'cs_fixture',livemode:false,customer:'cus_fixture',status:'complete',mode:'subscription',payment_status:'paid',subscription:sub.id,url:'https://checkout.stripe.com/test'};
  const portalConfig = {id:'bpc_fixture',active:true,livemode:false,features:{subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:false}}};
  return {sub,session,portalConfig,get calls(){return calls;},prices:{retrieve:async()=>({active:true,livemode:false,currency:'usd',unit_amount:4900,recurring:{interval:'year',interval_count:1}})},customers:{create:async()=>({id:'cus_fixture',livemode:false})},subscriptions:{retrieve:async()=>{calls++;return copy(sub);}},
    billingPortal:{configurations:{retrieve:async()=>copy(portalConfig)},sessions:{create:async params=>({url:'https://billing.stripe.com/test',...params})}},
    checkout:{sessions:{create:async()=>copy(session),retrieve:async()=>copy(session),expire:async()=>{}}},
    invoices:{retrieve:async()=>copy(sub.latest_invoice)},invoicePayments:{list:async()=>({data:[{invoice:'in_fixture'}]})},charges:{retrieve:async()=>({id:'ch_fixture',payment_intent:'pi_fixture'})}};
}
async function billingUser() { const user = await account(); await U.updateUser(user.email,{emailVerified:true,stripeCustomer:'cus_fixture'}); await store.set('billing-customer:cus_fixture',user.email); return U.findUserInStore(user.email); }
test('sessions are opaque, survive fresh browsers and revoke on logout', async () => {
  const user = await account(); const token = await U.createSession(user);
  assert.match(token,/^[a-f0-9]{64}$/); assert.equal(token.includes(user.passwordHash),false);
  assert.equal((await U.login('PERSON@example.com','correct horse battery')).email,user.email);
  assert.equal((await U.readSession(token)).email,user.email);
  await U.revokeSession(token); assert.equal(await U.readSession(token),null);
});
test('duplicate concurrent signup cannot overwrite a password', async () => {
  const results = await Promise.allSettled([account(),account()]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.message,'user_exists');
});
test('legacy password-hash cookies are rejected', async()=>assert.equal(await U.readSession('eyJhbGciOiJIUzI1NiJ9.payload.signature'),null));
test('reset tokens are single use and revoke existing sessions', async()=>{
  const user = await account(); const session=await U.createSession(user); const token=await U.issueAction(user,'reset');
  await U.completeAction(token,'reset','a different strong password');
  assert.equal(await U.readSession(session),null);
  assert.equal(await U.login(user.email,'correct horse battery'),null);
  assert.ok(await U.login(user.email,'a different strong password'));
  await assert.rejects(()=>U.completeAction(token,'reset','another password'),/invalid_or_expired/);
});
test('email verification cannot be used as a password reset', async()=>{
  const user=await account(); const token=await U.issueAction(user,'verify');
  await assert.rejects(()=>U.completeAction(token,'reset','another password'),/invalid_or_expired/);
});
test('bad credentials, CSRF and repeated login attempts are rejected',async()=>{
  const handler=require('../api/auth/login'); await account();
  assert.equal((await invoke(handler,req({email:'person@example.com',password:'wrong password'}))).status,401);
  const cross=req({});cross.headers.origin='https://evil.invalid'; assert.equal((await invoke(handler,cross)).status,403);
  for(let i=0;i<10;i++)await invoke(handler,req({email:'person@example.com',password:'wrong password'}));
  assert.equal((await invoke(handler,req({email:'person@example.com',password:'wrong password'}))).status,429);
});
test('storage outage fails closed instead of falling back to cookie', async()=>{
  const old=store.get; store.get=async()=>{throw new Error('storage_unavailable');};
  try { const r=await invoke(require('../api/auth/login'),req({email:'person@example.com',password:'some password'})); assert.equal(r.status,503); }
  finally{store.get=old;}
});
test('licenses verify with public key alone and reject tampering/legacy tokens',()=>{
  const token=L.issue({email:'person@example.com',plan:'plus'});
  const privateKey=process.env.SG_LICENSE_PRIVATE_KEY; delete process.env.SG_LICENSE_PRIVATE_KEY;
  try { assert.ok(L.verify(token).ok); assert.throws(()=>L.issue({email:'person@example.com'})); }finally{process.env.SG_LICENSE_PRIVATE_KEY=privateKey;}
  const parts=token.split('.');const p=JSON.parse(Buffer.from(parts[1],'base64url'));p.plan='ultimate';parts[1]=Buffer.from(JSON.stringify(p)).toString('base64url');
  assert.equal(L.verify(parts.join('.')).ok,false);assert.equal(L.verify('e30.e30.bad').ok,false);
  assert.throws(()=>L.issue({email:'person@example.com',expires:1}),/expired/);
});
test('checkout without Stripe never mints a license',async()=>{
  const key=process.env.STRIPE_SECRET_KEY;delete process.env.STRIPE_SECRET_KEY;
  try { const r=await invoke(require('../api/checkout'),req({plan:'ultimate',email:'a@b.co'}));assert.equal(r.body.ok,false);assert.equal(r.body.token,undefined); }
  finally{process.env.STRIPE_SECRET_KEY=key;}
});
test('checkout requires login and verified email',async()=>{
  assert.equal((await invoke(require('../api/checkout'),req({plan:'plus'}))).status,401);
  const user=await account();await assert.rejects(()=>B.checkout(user,'plus',fakeStripe()),/verify_email/);
});
test('paid checkout activates the account and issues a short license',async()=>{
  const user=await billingUser();const stripe=fakeStripe();
  await B.processEvent({type:'checkout.session.completed',data:{object:{id:'cs_fixture'}}},stripe);
  const updated=await U.findUserInStore(user.email);assert.ok(B.active(updated));
  const parsed=L.verify(await B.accountLicense(updated)); assert.equal(parsed.payload.plan,'plus');
  assert.ok(parsed.payload.exp<=Math.floor(Date.now()/1000)+3*86400);
});
test('unpaid asynchronous checkout grants no access until success',async()=>{
  const user=await billingUser();const stripe=fakeStripe();stripe.session.payment_status='unpaid';
  await B.processEvent({type:'checkout.session.completed',data:{object:{id:'cs_fixture'}}},stripe);
  assert.ok(!B.active(await U.findUserInStore(user.email)));
  stripe.session.payment_status='paid';await B.processEvent({type:'checkout.session.async_payment_succeeded',data:{object:{id:'cs_fixture'}}},stripe);
  assert.ok(B.active(await U.findUserInStore(user.email)));
});
test('failed renewal and cancellation remove access; delayed payload does not restore it',async()=>{
  const user=await billingUser();const stripe=fakeStripe();await B.syncSubscription(stripe.sub.id,stripe);
  stripe.sub.status='past_due';stripe.sub.latest_invoice.status='open';
  await B.processEvent({type:'invoice.payment_failed',data:{object:{parent:{subscription_details:{subscription:stripe.sub.id}}}}},stripe);
  assert.ok(!B.active(await U.findUserInStore(user.email)));
  stripe.sub.status='canceled';await B.processEvent({type:'customer.subscription.updated',data:{object:{id:stripe.sub.id,status:'active'}}},stripe);
  assert.equal((await U.findUserInStore(user.email)).billing.status,'canceled');
});
test('full refund suspends access and later renewal cannot clear it',async()=>{
  const user=await billingUser();const stripe=fakeStripe();await B.syncSubscription(stripe.sub.id,stripe);
  await B.processEvent({id:'evt_refund',type:'charge.refunded',data:{object:{id:'ch_fixture',invoice:'in_fixture',refunded:true}}},stripe);
  assert.ok(await store.get('billing-risk-event:evt_refund'));
  await B.syncSubscription(stripe.sub.id,stripe);
  assert.ok(!B.active(await U.findUserInStore(user.email)));
});
test('unknown customer events cannot attach access to another email',async()=>{
  const user=await account();const stripe=fakeStripe();await B.syncSubscription(stripe.sub.id,stripe);
  assert.ok(!B.active(await U.findUserInStore(user.email)));
});
test('webhook checks real signatures, rejects replay timestamp, and deduplicates',async()=>{
  const Stripe=require('stripe');const sdk=new Stripe('rk_'+'test_fixture');
  const oldClient=B.client; const oldProcess=B.processEvent; let processed=0;
  B.client=()=>sdk;B.processEvent=async()=>{processed++;};
  const event={id:'evt_once',livemode:false,type:'checkout.session.completed',data:{object:{id:'cs_fixture'}}};
  const payload=JSON.stringify(event);
  const call=async header=>{const r=Readable.from([Buffer.from(payload)]);r.method='POST';r.headers={'stripe-signature':header};return invoke(require('../api/billing/webhook'),r);};
  try {
    assert.equal((await call('invalid')).status,400);
    assert.equal((await call(sdk.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET,timestamp:1}))).status,400);
    const signature=sdk.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET});
    assert.equal((await call(signature)).status,200);assert.equal((await call(signature)).body.duplicate,true);assert.equal(processed,1);
  }finally{B.client=oldClient;B.processEvent=oldProcess;}
});
test('webhook processing failure is retriable, not marked complete',async()=>{
  const Stripe=require('stripe');const sdk=new Stripe('rk_'+'test_fixture');const originalClient=B.client,originalProcess=B.processEvent;
  B.client=()=>sdk;B.processEvent=async()=>{throw new Error('storage_unavailable');};
  const payload=JSON.stringify({id:'evt_retry',livemode:false,type:'invoice.paid',data:{object:{}}});
  const r=Readable.from([Buffer.from(payload)]);r.method='POST';r.headers={'stripe-signature':sdk.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET})};
  try{assert.equal((await invoke(require('../api/billing/webhook'),r)).status,503);assert.equal(await store.get('stripe-event:evt_retry'),null);}
  finally{B.client=originalClient;B.processEvent=originalProcess;}
});

test('checkout retries reuse one open session and its idempotency key', async()=>{
  const user=await billingUser(); const stripe=fakeStripe(); stripe.session.status='open';
  let creates=0; const attempts=[];
  stripe.checkout.sessions.create=async(params,options)=>{ creates++; attempts.push(options.idempotencyKey); return copy(stripe.session); };
  const originalSet=store.set; let fail=true;
  store.set=async(key,value,...rest)=>{
    if(fail && key.startsWith('checkout:') && value.session){fail=false;throw new Error('storage_unavailable');}
    return originalSet(key,value,...rest);
  };
  try {
    await assert.rejects(()=>B.checkout(user,'plus',stripe),/storage_unavailable/);
    await B.checkout(user,'plus',stripe);
    await B.checkout(user,'plus',stripe);
    assert.equal(creates,2); assert.equal(attempts[0],attempts[1]);
  } finally { store.set=originalSet; }
});
test('checkout rejects unintended prices, plans and duplicate active subscriptions',async()=>{
  const user=await billingUser(); const stripe=fakeStripe();
  stripe.prices.retrieve=async()=>({active:true,livemode:false,currency:'usd',unit_amount:4900,recurring:{interval:'month',interval_count:1}});
  await assert.rejects(()=>B.checkout(user,'plus',stripe),/billing_unavailable/);
  await assert.rejects(()=>B.checkout(user,'ultimate',stripe),/billing_unavailable/);
  await assert.rejects(()=>B.checkout({...user,billing:{subscription:'sub_existing',status:'past_due'}},'plus',stripe),/billing_already_active/);
});
test('a canceled older subscription cannot replace a newer entitlement',async()=>{
  const user=await billingUser(); const stripe=fakeStripe(); await B.syncSubscription(stripe.sub.id,stripe);
  stripe.sub.id='sub_old';stripe.sub.created=50;stripe.sub.status='canceled';
  await B.syncSubscription(stripe.sub.id,stripe);
  assert.equal((await U.findUserInStore(user.email)).billing.subscription,'sub_fixture');
  assert.ok(B.active(await U.findUserInStore(user.email)));
});
test('dispute and fraud warnings suspend access; partial refunds do not',async()=>{
  const user=await billingUser();const stripe=fakeStripe();await B.syncSubscription(stripe.sub.id,stripe);
  await B.processEvent({id:'evt_partial',type:'charge.refunded',data:{object:{id:'ch_fixture',payment_intent:'pi_fixture',refunded:false}}},stripe);
  assert.ok(B.active(await U.findUserInStore(user.email)));
  for(const type of ['charge.dispute.created','radar.early_fraud_warning.created']) {
    await store.del('billing-risk:sub_fixture');
    await B.processEvent({id:'evt_'+type,type,data:{object:{charge:'ch_fixture'}}},stripe);
    assert.ok(!B.active(await U.findUserInStore(user.email)));
  }
});
test('mismatched signing keys keep license issuance and checkout unavailable',()=>{
  const original=process.env.SG_LICENSE_PUBLIC_KEY;
  process.env.SG_LICENSE_PUBLIC_KEY=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
  try { assert.equal(L.canIssue(),false);assert.equal(B.ready(),false); }
  finally { process.env.SG_LICENSE_PUBLIC_KEY=original; }
});

function environment(t, changes) {
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}
test('checkout refuses absent or mismatched mode and live keys in preview before any Stripe operation', async t => {
  const user = await billingUser();
  environment(t, { SG_STRIPE_MODE: undefined, STRIPE_SECRET_KEY: 'rk_test_fixture', VERCEL_ENV: 'preview' });
  for (const [mode, key] of [[undefined,'rk_test_fixture'], ['live','rk_test_fixture'], ['test','rk_live_fixture'], ['live','rk_live_fixture']]) {
    if (mode) process.env.SG_STRIPE_MODE = mode; else delete process.env.SG_STRIPE_MODE;
    process.env.STRIPE_SECRET_KEY = key;
    assert.equal(B.ready(), false);
    assert.throws(() => B.client(), /billing_unavailable/);
    await assert.rejects(() => B.checkout(user, 'plus', {}), /billing_unavailable/);
  }
  process.env.SG_STRIPE_MODE = 'test'; process.env.STRIPE_SECRET_KEY = 'rk_test_fixture';
  assert.equal(B.ready(), true);
});
test('checkout rejects a price from the wrong Stripe mode before creating a session', async () => {
  const stripe = fakeStripe(); const user = await billingUser(); let creates = 0;
  const price = await stripe.prices.retrieve(); price.livemode = true;
  stripe.prices.retrieve = async () => price;
  stripe.checkout.sessions.create = async () => { creates++; return stripe.session; };
  await assert.rejects(() => B.checkout(user, 'plus', stripe), /billing_unavailable/);
  assert.equal(creates, 0);
});
test('customers can open the configured cancellation portal while new sales and email are disabled', async t => {
  const user = await billingUser(); const stripe = fakeStripe();
  const cookie = 'sg_session=' + await U.createSession(user);
  environment(t, { SG_BILLING_ENABLED: 'false', RESEND_API_KEY: undefined, SG_LICENSE_PRIVATE_KEY: undefined, SG_DOWNLOAD_URL: undefined });
  assert.equal(B.ready(), false); assert.equal(B.portalReady(), true);
  const original = B.portal; B.portal = customer => original(customer, stripe); t.after(() => { B.portal = original; });
  let requested;
  stripe.billingPortal.sessions.create = async params => { requested = params; return {url:'https://billing.stripe.com/test'}; };
  const r = await invoke(require('../api/billing/portal'), req({}, cookie));
  assert.equal(r.status, 200); assert.equal(requested.customer, user.stripeCustomer);
  assert.equal(requested.configuration, process.env.STRIPE_PORTAL_CONFIGURATION);
  assert.equal(requested.return_url, process.env.PUBLIC_ORIGIN + '/members');
  assert.equal((await invoke(require('../api/billing/portal'), req())).status, 401);
  const me = await invoke(require('../api/auth/me'), {method:'GET',headers:{cookie}});
  assert.equal(me.body.billing.available, false); assert.equal(me.body.billing.portalAvailable, true);
});
test('portal rejects disabled cancellation, immediate cancellation, unsupported upgrades and wrong mode', async () => {
  const user = await billingUser();
  for (const change of [c => {c.active=false;}, c => {c.features.subscription_cancel.enabled=false;}, c => {c.features.subscription_cancel.mode='immediately';}, c => {c.features.subscription_update.enabled=true;}, c => {c.livemode=true;}]) {
    const stripe = fakeStripe(); change(stripe.portalConfig); let creates = 0;
    stripe.billingPortal.sessions.create = async () => { creates++; };
    await assert.rejects(() => B.portal(user, stripe), /billing_unavailable/);
    assert.equal(creates, 0);
  }
});
test('an ended subscription allows a new checkout with a fresh idempotency key', async () => {
  const user = await billingUser(); const stripe = fakeStripe();
  const key = 'checkout:' + U.digest(user.email);
  for (const status of ['canceled', 'incomplete_expired']) {
    stripe.sub.status = status;
    await store.set(key, {session:'cs_old',plan:'plus',attempt:'previous'});
    let attempt;
    stripe.checkout.sessions.create = async (_, options) => { attempt = options.idempotencyKey; return {...stripe.session,id:'cs_new',status:'open'}; };
    assert.equal((await B.checkout({...user,billing:{subscription:stripe.sub.id,status}}, 'plus', stripe)).id, 'cs_new');
    assert.notEqual(attempt, 'sg-checkout-previous');
    assert.equal((await store.get(key)).session, 'cs_new');
  }
});
test('a delayed webhook cannot allow a second purchase while Stripe still has a nonterminal subscription', async () => {
  const user = await billingUser(); const stripe = fakeStripe(); let creates = 0;
  await store.set('checkout:' + U.digest(user.email), {session:'cs_old',plan:'plus',attempt:'previous'});
  stripe.checkout.sessions.create = async () => { creates++; return stripe.session; };
  for (const status of ['active', 'past_due', 'unpaid', 'incomplete', 'trialing', 'paused']) {
    stripe.sub.status = status;
    await assert.rejects(() => B.checkout(user, 'plus', stripe), /billing_already_active/);
  }
  assert.equal(creates, 0);
});
test('cached checkout and subscription must belong to the signed-in customer', async () => {
  const user = await billingUser(); const stripe = fakeStripe();
  await store.set('checkout:' + U.digest(user.email), {session:'cs_old',plan:'plus'});
  stripe.session.customer = 'cus_someone_else';
  await assert.rejects(() => B.checkout(user, 'plus', stripe), /billing_unavailable/);
  stripe.session.customer = user.stripeCustomer; stripe.sub.customer = 'cus_someone_else'; stripe.sub.status = 'canceled';
  await assert.rejects(() => B.checkout(user, 'plus', stripe), /billing_unavailable/);
});
test('checkout rereads account state after acquiring the lease', async t => {
  const user = await billingUser(); const cookie = 'sg_session=' + await U.createSession(user);
  const originalCreate = store.create, originalCheckout = B.checkout;
  store.create = async (key, value, ...args) => {
    const result = await originalCreate(key, value, ...args);
    if (key.startsWith('checkout-lock:')) await U.updateUser(user.email, {billing:{subscription:'sub_just_paid',status:'active'}});
    return result;
  };
  B.checkout = customer => originalCheckout(customer, 'plus', fakeStripe());
  t.after(() => { store.create=originalCreate; B.checkout=originalCheckout; });
  const r = await invoke(require('../api/checkout'), req({plan:'plus'}, cookie));
  assert.equal(r.body.error, 'billing_already_active');
  assert.equal(await store.get('checkout-lock:' + U.digest(user.email)), null);
});
test('validly signed live webhook is rejected by a test deployment without marking it complete', async t => {
  const Stripe = require('stripe'); const sdk = new Stripe('rk_test_fixture');
  const original = B.client; B.client = () => sdk; t.after(() => {B.client=original;});
  const payload = JSON.stringify({id:'evt_wrongmode',livemode:true,type:'invoice.paid',data:{object:{}}});
  const r = Readable.from([Buffer.from(payload)]); r.method='POST';
  r.headers={'stripe-signature':sdk.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET})};
  const result = await invoke(require('../api/billing/webhook'), r);
  assert.equal(result.status, 400); assert.equal(result.body.error, 'mode_mismatch');
  assert.equal(await store.get('stripe-event:evt_wrongmode'), null);
});
test('license issuer and verifier both enforce the three-day maximum', () => {
  const now = Math.floor(Date.now()/1000);
  assert.throws(() => L.issue({email:'person@example.com',plan:'plus',expires:now+4*86400}), /expired/);
  const parts = L.issue({email:'person@example.com',plan:'plus'}).split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url')); payload.exp = payload.iat + 4*86400;
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  parts[2] = crypto.sign(null, Buffer.from(parts[0]+'.'+parts[1]), keys.privateKey).toString('base64url');
  assert.equal(L.verify(parts.join('.')).ok, false);
});
test('desktop rejects licenses signed by an environment override instead of its bundled key', t => {
  const token = L.issue({email:'person@example.com',plan:'plus'});
  assert.equal(L.verify(token).ok, true);
  environment(t, {SG_DESKTOP_BUILD:'true'});
  assert.equal(L.verify(token).ok, false);
  assert.equal(L.canIssue(), false);
});
test('invalid canonical origins keep checkout and the customer portal unavailable', t => {
  environment(t, {PUBLIC_ORIGIN:process.env.PUBLIC_ORIGIN});
  for (const value of ['https://sentivoguard.com/path', 'https://user:password@sentivoguard.com', 'http://sentivoguard.com', 'https://sentivoguard.com/?q=1']) {
    process.env.PUBLIC_ORIGIN=value;
    assert.throws(() => H.origin(), /service_unavailable/);
    assert.equal(B.ready(), false); assert.equal(B.portalReady(), false);
  }
});

test('old installer URLs stay unavailable until release approval explicitly enables downloads', async t => {
  const user=await account(); const cookie='sg_session='+await U.createSession(user);
  environment(t,{SG_DOWNLOAD_ENABLED:undefined});
  const request={method:'GET',headers:{cookie}};
  const blocked=await invoke(require('../api/download'),request);
  assert.equal(blocked.status,503); assert.equal(blocked.headers.location,undefined);
  assert.equal((await invoke(require('../api/auth/me'),request)).body.downloadAvailable,false);
  assert.equal(B.ready(),false);
  process.env.SG_DOWNLOAD_ENABLED='true';
  const enabled=await invoke(require('../api/download'),request);
  assert.equal(enabled.status,302); assert.equal(enabled.headers.location,process.env.SG_DOWNLOAD_URL);
  assert.equal((await invoke(require('../api/auth/me'),request)).body.downloadAvailable,true);
  assert.equal((await invoke(require('../api/download'),{method:'GET',headers:{}})).status,401);
});
test('malformed, insecure or credential-bearing download URLs cannot enable checkout or redirects', async t => {
  const user=await account(); const cookie='sg_session='+await U.createSession(user);
  environment(t,{SG_DOWNLOAD_ENABLED:'true',SG_DOWNLOAD_URL:undefined});
  for(const url of ['not a URL','http://downloads.invalid/app.exe','https://user:password@downloads.invalid/app.exe']) {
    process.env.SG_DOWNLOAD_URL=url;
    const r=await invoke(require('../api/download'),{method:'GET',headers:{cookie}});
    assert.equal(r.status,503); assert.equal(r.headers.location,undefined); assert.equal(B.ready(),false);
  }
});
