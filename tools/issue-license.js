#!/usr/bin/env node
// SentivoGuard — issue a license key.
//
// Operator-only development utility. Production licenses come from the members API.
// For isolated local testing with a disposable Ed25519 pair:
//   node tools/issue-license.js you@example.com plus 3
//
// Production: deploy this on the same backend that handles Stripe webhooks,
// using SG_LICENSE_PRIVATE_KEY and SG_LICENSE_PUBLIC_KEY from the environment.

const { issue, PLANS } = require("../server/license");

const [, , email, plan = "plus", daysStr = "3"] = process.argv;

if (!email || email === "--help" || email === "-h") {
  console.log("Usage: node tools/issue-license.js <email> [plan] [days]");
  console.log("");
  console.log("  email   customer's email (becomes JWT 'sub' claim)");
  console.log("  plan    one of: " + Object.keys(PLANS).join(", ") + "  (default: plus)");
  console.log("  days    days until expiry (default: 3, maximum: 3)");
  console.log("");
  console.log("Set the Ed25519 private and public key environment variables; never ship the private key.");
  process.exit(email ? 0 : 1);
}

const days = parseInt(daysStr, 10);
if (!Number.isFinite(days) || days < 1 || days > 3) {
  console.error("days must be a positive integer (1–3)");
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
