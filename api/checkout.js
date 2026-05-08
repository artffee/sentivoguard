// POST /api/checkout
// Body: { plan: "standard" | "plus" | "ultimate", email?: string }
//
// Production: creates a Stripe Checkout session and returns the redirect URL.
//   Required env: STRIPE_SECRET_KEY, STRIPE_PRICE_<PLAN> for each plan.
//
// Dev fallback (when STRIPE_SECRET_KEY is missing):
//   - Mints a license JWT directly so the full members → download flow can
//     be exercised without real payment.
//   - If the user is logged in (sg_session cookie present), the new license
//     is attached to their session automatically. Otherwise it's returned in
//     the JSON so they can paste it into /members.
//
// Production setup:
//   vercel env add STRIPE_SECRET_KEY production
//   vercel env add STRIPE_PRICE_STANDARD production
//   vercel env add STRIPE_PRICE_PLUS    production
//   vercel env add STRIPE_PRICE_ULTIMATE production

const { issue }      = require("../server/license");
const {
  readSession, attachLicense, createSession, SESSION_LIFETIME
} = require("../lib/users");
const { readCookie, setCookie } = require("../lib/cookies");

const PLANS = {
  standard: { days: 365 },
  plus:     { days: 365 },
  ultimate: { days: 365 }
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const plan       = (body.plan || "plus").toLowerCase();
  const bodyEmail  = (body.email || "").trim();

  if (!PLANS[plan]) return json(res, 400, { ok: false, error: "unknown_plan" });

  // Pull the logged-in user (if any) so we can prefer their email and attach
  // the resulting license to their session.
  const sessionToken = readCookie(req, "sg_session");
  const user         = sessionToken ? readSession(sessionToken) : null;

  const email = (user && user.email) || bodyEmail;

  // ── Dev fallback ──
  if (!process.env.STRIPE_SECRET_KEY) {
    if (!email) {
      return json(res, 400, {
        ok: false,
        error: "email_required_in_dev",
        message: "STRIPE_SECRET_KEY isn't set so this endpoint is in dev mode. " +
                 "Either log in first, or pass `email` in the body."
      });
    }

    let token;
    try { token = issue({ email, plan, days: PLANS[plan].days }); }
    catch (e) {
      return json(res, 500, { ok: false, error: "issue_failed", detail: e.message });
    }

    // If logged in, attach the new license to the session and refresh the cookie.
    let attached = false;
    if (user && user.email.toLowerCase() === email.toLowerCase()) {
      const updated = attachLicense(user, token);
      setCookie(res, "sg_session", createSession(updated), SESSION_LIFETIME);
      attached = true;
    }

    return json(res, 200, {
      ok:       true,
      devMode:  true,
      attached,                 // session updated, no manual paste needed
      token:    attached ? null : token,   // only echo the JWT if not attached
      message:  attached
        ? "Test license minted and attached to your session."
        : "Test license minted (Stripe not configured). Paste the token at /members to activate."
    });
  }

  // ── Real Stripe Checkout ──
  const priceEnv = "STRIPE_PRICE_" + plan.toUpperCase();
  const priceId  = process.env[priceEnv];
  if (!priceId) {
    return json(res, 500, {
      ok: false,
      error: "missing_price_id",
      detail: `Set ${priceEnv} env var (Stripe price ID for the ${plan} plan)`
    });
  }

  const successUrl = `${baseUrl(req)}/members?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = `${baseUrl(req)}/?cancelled=1`;

  const params = new URLSearchParams();
  params.append("mode",                  "subscription");
  params.append("line_items[0][price]",  priceId);
  params.append("line_items[0][quantity]", "1");
  params.append("success_url",           successUrl);
  params.append("cancel_url",            cancelUrl);
  params.append("client_reference_id",   plan);
  params.append("metadata[plan]",        plan);
  if (email) params.append("customer_email", email);

  let stripeResp;
  try {
    stripeResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method:  "POST",
      headers: {
        "Authorization": "Bearer " + process.env.STRIPE_SECRET_KEY,
        "Content-Type":  "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
  } catch (e) {
    return json(res, 502, { ok: false, error: "stripe_unreachable", detail: e.message });
  }

  const stripeJson = await stripeResp.json().catch(() => ({}));
  if (!stripeResp.ok) {
    return json(res, 502, {
      ok:    false,
      error: "stripe_error",
      detail: stripeJson.error?.message || ("http_" + stripeResp.status)
    });
  }

  return json(res, 200, {
    ok:        true,
    devMode:   false,
    sessionId: stripeJson.id,
    url:       stripeJson.url
  });
};

function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"]  || req.headers.host;
  return proto + "://" + host;
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type",  "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
