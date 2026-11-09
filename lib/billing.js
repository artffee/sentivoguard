const store = require('./store');
const users = require('./users');
const license = require('../server/license');
const email = require('./email');
const { origin } = require('./http');
const id = value => typeof value === 'string' ? value : value?.id;
const prices = () => Object.fromEntries(['standard', 'plus', 'ultimate'].map(p => [p, process.env['STRIPE_PRICE_' + p.toUpperCase()]]));
function client() {
  const Stripe = require('stripe');
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-10-28.endive', maxNetworkRetries: 2, timeout: 10000 });
}
function ready() {
  return process.env.SG_BILLING_ENABLED === 'true' && !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET &&
    !!process.env.PUBLIC_ORIGIN && !!process.env.SG_DOWNLOAD_URL && store.configured() && email.configured() && license.canIssue() && !!prices().plus;
}
function active(user) {
  const b = user?.billing;
  return b && !b.suspended && b.status === 'active' && b.paidThrough > Date.now() / 1000 && Object.hasOwn(license.PLANS, b.plan);
}
function context(user) {
  const b = user?.billing;
  const plan = active(user) ? b.plan : 'free';
  return { email: user.email, plan, devices: license.PLANS[plan].devices, expires: active(user) ? b.paidThrough : null, tier: license.PLANS[plan] };
}
async function accountLicense(user) {
  const c = context(user);
  const now = Math.floor(Date.now() / 1000);
  return license.issue({ email: user.email, plan: c.plan, expires: Math.min(now + 3 * 86400, c.expires || now + 3 * 86400), subscription: active(user) ? user.billing.subscription : null });
}
async function checkout(user, plan, stripe = client()) {
  if (!ready() || plan !== 'plus') throw new Error('billing_unavailable');
  if (!user.emailVerified) throw new Error('verify_email_first');
  if (user.billing?.subscription && !['canceled', 'incomplete_expired'].includes(user.billing.status)) throw new Error('billing_already_active');
  const price = await stripe.prices.retrieve(prices()[plan]);
  if (!price.active || price.currency !== 'usd' || price.unit_amount !== 4900 || price.recurring?.interval !== 'year' || price.recurring.interval_count !== 1) throw new Error('billing_unavailable');
  // A durable, deterministic customer mapping is written BEFORE checkout can create events.
  let customer = user.stripeCustomer;
  if (!customer) {
    const c = await stripe.customers.create({ email: user.email }, { idempotencyKey: 'sg-customer-' + users.digest(user.email) });
    customer = c.id;
    await store.set('billing-customer:' + customer, user.email);
    await users.updateUser(user.email, { stripeCustomer: customer });
  }
  await store.set('billing-customer:' + customer, user.email);
  const pendingKey = 'checkout:' + users.digest(user.email);
  let pending = await store.get(pendingKey);
  if (pending?.session) {
    const existing = await stripe.checkout.sessions.retrieve(pending.session);
    if (existing.status === 'complete') throw new Error('billing_already_active');
    if (existing.status === 'open') {
      if (pending.plan === plan) return existing;
      await stripe.checkout.sessions.expire(existing.id);
    }
    pending = null;
  }
  // Stable key for retries of a checkout attempt; rotates after an expired session.
  const attempt = pending?.attempt || require('node:crypto').randomUUID();
  if (pending?.plan && pending.plan !== plan) throw new Error('billing_already_active');
  await store.set(pendingKey, { attempt, plan }, 86400);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', customer, line_items: [{ price: prices()[plan], quantity: 1 }],
    success_url: origin() + '/members?checkout=processing', cancel_url: origin() + '/members?checkout=cancelled',
    integration_identifier: 'sentivoguard-' + users.digest(attempt).slice(0, 8).replace(/[0-9]/g, 'a')
  }, { idempotencyKey: 'sg-checkout-' + attempt });
  await store.set(pendingKey, { session: session.id, plan, attempt }, 86400);
  return session;
}
async function syncSubscription(subscriptionId, stripe, risk) {
  // Fetch current state for every event so delayed webhook payloads cannot restore canceled access.
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
  const email = await store.get('billing-customer:' + id(sub.customer));
  if (!email) return { ignored: true };
  const user = await users.findUserInStore(email);
  if (!user || user.stripeCustomer !== id(sub.customer)) throw new Error('billing_owner_missing');
  if (user.billing?.subscription && user.billing.subscription !== sub.id && (sub.status === 'canceled' || (user.billing.subscriptionCreated || 0) > sub.created)) return { ignored: true };
  const item = sub.items?.data?.[0];
  const plan = Object.entries(prices()).find(([, price]) => price && price === id(item?.price))?.[0];
  if (!plan || sub.items.data.length !== 1 || item.quantity !== 1) throw new Error('unexpected_subscription_price');
  const invoice = typeof sub.latest_invoice === 'string' ? await stripe.invoices.retrieve(sub.latest_invoice) : sub.latest_invoice;
  let paidThrough = user.billing?.subscription === sub.id ? user.billing.paidThrough || 0 : 0;
  const paidLine = invoice?.lines?.data?.find(line => id(line.pricing?.price_details?.price || line.price) === id(item?.price));
  const end = paidLine?.period?.end || 0;
  if (invoice?.status === 'paid' && sub.status === 'active' && end) paidThrough = Math.max(paidThrough, end);
  else if (user.billing?.plan !== plan) paidThrough = 0;
  // Risk flags persist across ordinary renewals until reviewed by the operator.
  const riskKey = 'billing-risk:' + sub.id;
  if (risk) await store.set(riskKey, { reason: risk, at: new Date().toISOString() });
  const suspended = !!await store.get(riskKey);
  const billing = { subscription: sub.id, subscriptionCreated: sub.created || 0, plan, status: sub.status, paidThrough, suspended, cancelAtPeriodEnd: !!sub.cancel_at_period_end };
  await users.updateUser(email, { billing });
  return { email, billing };
}
async function subscriptionFromCharge(charge, stripe) {
  let invoiceId = id(charge.invoice);
  // Newer Stripe versions link invoice payments through PaymentIntent.
  if (!invoiceId && charge.payment_intent) {
    const payments = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: id(charge.payment_intent) }, limit: 10 });
    invoiceId = id(payments.data[0]?.invoice);
  }
  if (!invoiceId) return null;
  const invoice = await stripe.invoices.retrieve(invoiceId);
  return id(invoice.parent?.subscription_details?.subscription || invoice.subscription);
}
async function processEvent(event, stripe = client()) {
  const obj = event.data.object;
  let subscriptionId;
  let risk;
  if (event.type.startsWith('checkout.session.')) {
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return { ignored: true };
    const session = await stripe.checkout.sessions.retrieve(obj.id);
    if (session.mode !== 'subscription' || session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status)) return { ignored: true };
    subscriptionId = id(session.subscription);
  } else if (event.type.startsWith('customer.subscription.')) subscriptionId = obj.id;
  else if (['invoice.paid', 'invoice.payment_failed'].includes(event.type)) subscriptionId = id(obj.parent?.subscription_details?.subscription || obj.subscription);
  else if (['charge.refunded', 'charge.dispute.created', 'radar.early_fraud_warning.created'].includes(event.type)) {
    const charge = event.type === 'charge.refunded' ? obj : await stripe.charges.retrieve(id(obj.charge));
    subscriptionId = await subscriptionFromCharge(charge, stripe);
    if (event.type !== 'charge.refunded' || charge.refunded) risk = event.type;
    // Partial refunds are recorded for review without automatically removing access.
    await store.set('billing-risk-event:' + event.id, { type: event.type, charge: charge.id, fullRefund: !!charge.refunded });
  } else return { ignored: true };
  if (!subscriptionId) return { ignored: true };
  return syncSubscription(subscriptionId, stripe, risk);
}
module.exports = { ready, client, checkout, processEvent, context, active, accountLicense, syncSubscription };
