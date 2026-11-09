const H = require('../../lib/http');
const billing = require('../../lib/billing');
const store = require('../../lib/store');
module.exports = H.endpoint(async (req, res) => {
  if (req.method !== 'POST') return H.json(res, 405, { ok: false });
  if (!process.env.STRIPE_WEBHOOK_SECRET || !store.configured()) return H.json(res, 503, { ok: false });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) return H.json(res, 413, { ok: false });
    chunks.push(Buffer.from(chunk));
  }
  const stripe = billing.client();
  let event;
  try { event = stripe.webhooks.constructEvent(Buffer.concat(chunks), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return H.json(res, 400, { ok: false, error: 'invalid_signature' }); }
  const live = /^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || '');
  if (event.livemode !== live) return H.json(res, 400, { ok: false, error: 'mode_mismatch' });
  const doneKey = 'stripe-event:' + event.id;
  if (await store.get(doneKey)) return H.json(res, 200, { ok: true, duplicate: true });
  // Serialize account reconciliation, including different events for the same customer.
  // Contention returns a retriable failure; the lock is not an event completion marker.
  const lock = 'billing-webhook-lock';
  const owner = require('node:crypto').randomUUID();
  if (!await store.create(lock, owner, 300)) return H.json(res, 503, { ok: false });
  try {
    if (!await store.get(doneKey)) {
      await billing.processEvent(event, stripe);
      await store.set(doneKey, true, 90 * 86400);
    }
  } finally { await store.release(lock, owner); }
  H.json(res, 200, { ok: true });
});
module.exports.config = { api: { bodyParser: false } };
