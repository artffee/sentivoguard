# Deployment and migration for version 2.2

## Prepared configuration

The existing Vercel `sentivoguard` project has Redis connection settings and an existing installer URL. Version 2.2 adds these production settings:

- `PUBLIC_ORIGIN=https://sentivoguard.com`
- `SG_BILLING_ENABLED=false`
- A new Ed25519 private signing key stored as a sensitive production secret.
- The corresponding public key, also committed at `server/license-public.pem` for the desktop build.

These environment changes take effect on a new deployment. No production deployment or customer charge is performed by this code change. The existing download URL has not been certified as a version 2.2 build.

The connected Stripe account is Orion Mind, live mode. No SentivoGuard product or price was found. Do not reuse Orion Saint book prices or its webhook. Creating new Stripe products requires the owner's sales tax/VAT/GST decision. Restricted API credentials cannot be provisioned with the available Stripe connector.

## Required settings

| Variable | Scope and purpose |
|---|---|
| `PUBLIC_ORIGIN` | Exact canonical HTTPS origin; cookies, checkout returns and email links use it. Redirect other hostnames to this origin. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Private Redis REST connection, or the equivalent `UPSTASH_REDIS_REST_*` pair. Commands include GET, SET/NX/EX, GETDEL, DEL, EVAL, INCR, EXPIRE. Use a separate database for test/preview. |
| `RESEND_API_KEY`, `RESEND_FROM` | Transactional email key and verified sender for account verification/reset. Checkout requires verified email. |
| `STRIPE_SECRET_KEY` | Restricted server key with only required customer, price, Checkout Session, subscription, invoice/invoice-payment, charge and billing portal permissions. Read/write requirements follow the calls in `lib/billing.js` and `api/billing/portal.js`. |
| `STRIPE_PRICE_PLUS` | Active USD 4900 annual recurring price, interval count 1. Wrong amount/currency/cadence is rejected. |
| `STRIPE_PRICE_STANDARD`, `STRIPE_PRICE_ULTIMATE` | Optional IDs only for reconciling existing subscriptions during migration. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for this project's exact `/api/billing/webhook` endpoint. |
| `SG_LICENSE_PRIVATE_KEY` | Ed25519 PKCS#8 PEM. Production server only. |
| `SG_LICENSE_PUBLIC_KEY` | Matching SPKI PEM; desktop also uses the bundled public PEM. |
| `SG_DOWNLOAD_URL` | HTTPS URL of the tested new installer; the URL is shareable after download and is not itself an authorization boundary. |
| `SG_BILLING_ENABLED` | Keep `false` until the steps below pass. |

Never copy production keys into preview, development, GitHub Actions or the desktop package. Existing preview Redis variables should be replaced with a separate test database before preview write tests.

## Stripe setup and activation

1. Confirm sales tax/VAT/GST collection with the owner before creating the product. If collecting, configure registrations and the appropriate product tax code and price tax behavior. Automatic tax is not enabled by this implementation; configure and test it before enabling checkout if needed.
2. Create a dedicated SentivoGuard Plus product and $49 USD/year recurring price in a Stripe sandbox first. Configure a restricted server key, the customer portal, verified transactional sender, and a disposable signing pair in a separate test deployment. Configure the portal for cancellation at period end and payment-method/invoice management; do not allow unsupported price changes.
3. Create a dedicated webhook at `https://<test-host>/api/billing/webhook`, using API version `2026-10-28.endive`, for:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - `invoice.paid`, `invoice.payment_failed`
   - `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created`
4. Verify signup, email delivery, verification, login in a second browser, reset and logout. Confirm price amount and billing cadence in hosted checkout. Confirm paid access is granted only after a verified webhook. Exercise duplicate/reordered events, an unpaid asynchronous checkout, failed renewal, cancellation at period end, immediate cancellation, partial/full refund, dispute and early fraud warning.
5. Build a Windows installer with the production public key. Test installation, scan, quarantine/restore, read-only Windows views, paid monitoring, vault, Nova key storage, paid-license activation and online renewal. Verify the three-day offline expiry and that explicit revocation disables monitoring. Review false positives before moving files.
6. Review the existing commercial terms before sale: the repository still contains a governing-law placeholder, and the support address and refund process need owner verification. Ensure account deletion/data-access requests can be handled. No legal jurisdiction or tax registration is assumed here.
7. Configure the equivalent live Stripe price, restricted key, customer portal and webhook at `https://sentivoguard.com/api/billing/webhook`. Upload the tested installer and update `SG_DOWNLOAD_URL`. Deploy with checkout disabled, verify login and download, then enable billing and redeploy. Only perform a live charge when specifically authorized.

Stripe and the deployment must use the same mode. Signature failures return 400. Processing/storage failures return 503 so Stripe can retry. The event is marked complete only after successful reconciliation. Concurrent webhook processing uses a lease; an expired worker cannot delete a replacement lock.

## Account and license migration

- Existing `user:<normalized-email>` Redis records and scrypt passwords are preserved. Atomic patches avoid overwriting concurrent billing/password changes.
- Legacy JWT session cookies are intentionally rejected because they contained password hashes. Users must sign in again. Old cookie-only accounts were never persisted and must create an account in the new store.
- Existing users must verify their email before new checkout. Resetting a password invalidates existing sessions and pending tokens through a session version.
- Old HS256 license keys are not accepted by version 2.2. Do not import a paid tier merely because an old cookie or token says so. Reconcile existing genuine purchases against Stripe customer ownership and payment records, then issue the new license from the account.
- The old `SG_LICENSE_SECRET` remains untouched during preparation. Remove it only after the old release is retired. Do not include it in new desktop builds.
- Existing activity history is preserved under `legacyActivity` for export. Only explicitly measured old events remain in the current feed; fabricated demo status is not shown as protection.
- Previously stored renderer Nova API keys are removed from localStorage. Users re-enter their key into the OS-encrypted desktop setting. Vault data is preserved.

## Operational limits

This change is not a complete security audit or certified antivirus release. Heuristic scans skip binary content, limit text inspected and skip some paths; the UI reports coverage. Paid access is a short signed bearer lease, so copies can remain usable until expiry, at most three days. There is no hardware-bound device enforcement.

Full refunds, disputes and fraud warnings persist a `billing-risk:<subscription>` flag. Renewals cannot clear it. Review the Stripe record and resolve the cause before an operator removes that flag; no automatic unsuspension is provided. Refunding a payment does not itself cancel future Stripe subscription billing: handle cancellation separately. Partial refunds are recorded for review without automatic suspension.

Local tests use mocked Redis and Stripe operations, real Stripe signature validation, and a real Node loopback server/filesystem. They do not replace a sandbox purchase, real Redis EVAL compatibility checks, verified email delivery or Windows testing.
