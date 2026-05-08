#!/usr/bin/env node
// SentivoGuard — issue a license key.
//
// Run after a successful Stripe checkout (webhook handler). For local testing:
//   node tools/issue-license.js you@example.com plus 365
//
// Production: deploy this on the same backend that handles Stripe webhooks,
// using SG_LICENSE_SECRET from the environment (NOT the prototype default).

const { issue, PLANS } = require("../server/license");

const [, , email, plan = "plus", daysStr = "365"] = process.argv;

if (!email || email === "--help" || email === "-h") {
  console.log("Usage: node tools/issue-license.js <email> [plan] [days]");
  console.log("");
  console.log("  email   customer's email (becomes JWT 'sub' claim)");
  console.log("  plan    one of: " + Object.keys(PLANS).join(", ") + "  (default: plus)");
  console.log("  days    days until expiry (default: 365)");
  console.log("");
  console.log("Set SG_LICENSE_SECRET env var to use a non-default signing secret.");
  process.exit(email ? 0 : 1);
}

const days = parseInt(daysStr, 10);
if (!Number.isFinite(days) || days < 1 || days > 36500) {
  console.error("days must be a positive integer (1–36500)");
  process.exit(1);
}

try {
  const token = issue({ email, plan, days });
  console.log("");
  console.log("─── License Key (deliver to " + email + ") ──────────────");
  console.log(token);
  console.log("");
  console.log("Plan:    " + plan + "  (" + PLANS[plan].name + ")");
  console.log("Devices: " + PLANS[plan].devices);
  console.log("Expires: " + new Date(Date.now() + days * 86400 * 1000).toISOString());
  console.log("");
} catch (e) {
  console.error("Error:", e.message);
  process.exit(1);
}
