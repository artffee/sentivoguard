// Local configuration diagnostics only. Never print values or call providers.
const B = require('../lib/billing');
const L = require('../server/license');
const E = require('../lib/email');
const S = require('../lib/store');
const H = require('../lib/http');
const D = require('../lib/download');
function https(value) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }
let originValid = false;
try { originValid = H.origin() === process.env.PUBLIC_ORIGIN && https(process.env.PUBLIC_ORIGIN); } catch {}
console.log(JSON.stringify({
  checks: {
    canonicalHttpsOrigin: originValid,
    redisSettingsPresent: S.configured(),
    emailSettingsPresent: E.configured(),
    stripeKeyMatchesExplicitMode: !!B.stripeMode(),
    annualPriceIdPresent: !!process.env.STRIPE_PRICE_PLUS,
    webhookSecretPresent: !!process.env.STRIPE_WEBHOOK_SECRET,
    matchingLicenseSigningPair: L.canIssue(),
    httpsDownloadPresent: https(process.env.SG_DOWNLOAD_URL),
    installerDownloadEnabled: D.ready(),
    customerPortalConfigured: B.portalReady(),
    newSalesEnabled: process.env.SG_BILLING_ENABLED === 'true'
  },
  checkoutConfigured: B.ready(),
  note: 'Presence checks only. Price, portal, credentials, email delivery, Redis isolation and the installed release still require provider and end-to-end verification.'
}, null, 2));
