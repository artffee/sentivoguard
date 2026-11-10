# Deployment and migration for version 2.2.1

## Prepared configuration

The existing Vercel `sentivoguard` project has Redis connection settings and an existing installer URL. Version 2.2 adds these production settings:

- `PUBLIC_ORIGIN=https://sentivoguard.com`
- `SG_BILLING_ENABLED=false`
- A new Ed25519 private signing key stored as a sensitive production secret.
- The corresponding public key, also committed at `server/license-public.pem` for the desktop build.

These environment changes take effect on a new deployment. No production deployment or customer charge is performed by this code change. The existing download URL has not been certified as a version 2.2.1 build. The `fix/security-and-stripe` and `improve/release-readiness` branches explicitly disable Vercel Git auto-deployments in `vercel.json`; publishing source for review is separate from approving a deployment.

The previously deployed version does not implement the new billing switch and can return a simulated paid license without Stripe. A stored `SG_BILLING_ENABLED=false` is therefore not evidence that the old implementation has the new safeguards. Do not test production checkout. Replacing that old implementation requires an explicitly approved deployment; this draft does not change it.

The connected Stripe account is Orion Mind, live mode. No SentivoGuard product or price was found. Do not reuse Orion Saint book prices or its webhook. Creating new Stripe products requires the owner's sales tax/VAT/GST decision. Restricted API credentials cannot be provisioned with the available Stripe connector.

## Required settings

| Variable | Scope and purpose |
|---|---|
| `PUBLIC_ORIGIN` | Exact canonical HTTPS origin; cookies, checkout returns and email links use it. Redirect other hostnames to this origin. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Private Redis REST connection, or the equivalent `UPSTASH_REDIS_REST_*` pair. Commands include GET, SET/NX/EX, GETDEL, DEL, EVAL, INCR, EXPIRE. Use a separate database for test/preview. |
| `RESEND_API_KEY`, `RESEND_FROM` | Transactional email key and verified sender for account verification/reset. Checkout requires verified email. |
| `STRIPE_SECRET_KEY` | Restricted server key with only required customer, price, Checkout Session, subscription, invoice/invoice-payment, charge and billing portal permissions. Read/write requirements follow the calls in `lib/billing.js` and `api/billing/portal.js`. |
| `SG_STRIPE_MODE` | Required `test` or `live`; must match `rk_test_` / `rk_live_` (or equivalent secret-key) mode. Live keys are rejected when `VERCEL_ENV` is preview/development. |
| `STRIPE_PORTAL_CONFIGURATION` | Dedicated `bpc_...` configuration in the same mode. It must be active, enable cancellation at period end and disable subscription price changes. The app validates it before opening a portal session. |
| `STRIPE_PRICE_PLUS` | Active USD 4900 annual recurring price, interval count 1. Wrong amount/currency/cadence is rejected. |
| `STRIPE_PRICE_STANDARD`, `STRIPE_PRICE_ULTIMATE` | Optional IDs only for reconciling existing subscriptions during migration. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for this project's exact `/api/billing/webhook` endpoint. |
| `SG_LICENSE_PRIVATE_KEY` | Ed25519 PKCS#8 PEM. Production server only. |
| `SG_LICENSE_PUBLIC_KEY` | Matching SPKI PEM; desktop also uses the bundled public PEM. |
| `SG_DOWNLOAD_ENABLED` | Defaults to false. Set true only after approval of the installed, tested installer. New checkout also requires downloads to be enabled. |
| `SG_DOWNLOAD_URL` | HTTPS URL of the tested new installer; the URL is shareable after download and is not itself an authorization boundary. |
| `SG_BILLING_ENABLED` | Keep production `false` until the steps below pass and the owner approves. Pausing new sales does not disable existing customers' portal or webhook reconciliation. |

Never copy production keys into preview, development, GitHub Actions or the desktop package. Existing preview Redis variables should be replaced with a separate test database before preview write tests.

## Stripe setup and activation

1. Confirm sales tax/VAT/GST collection with the owner before creating the product. If collecting, configure registrations and the appropriate product tax code and price tax behavior. Automatic tax is not enabled by this implementation; configure and test it before enabling checkout if needed.
2. After explicit owner approval, create a dedicated SentivoGuard Plus product and $49 USD/year recurring price in a Stripe sandbox first. Configure a restricted server key, the customer portal, verified transactional sender, and a disposable signing pair in a separate test deployment. Set `SG_STRIPE_MODE=test` and the dedicated `STRIPE_PORTAL_CONFIGURATION`. Configure the portal for cancellation at period end and payment-method/invoice management; do not allow unsupported price changes. Enable `SG_BILLING_ENABLED=true` only in that isolated environment after approval of the sandbox test plan.
3. Create a dedicated webhook at `https://<test-host>/api/billing/webhook`, using API version `2026-10-28.endive`, for:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - `invoice.paid`, `invoice.payment_failed`
   - `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created`
4. Verify signup, email delivery, verification, login in a second browser, reset and logout. Confirm price amount and billing cadence in hosted checkout. Confirm paid access is granted only after a verified webhook. Exercise duplicate/reordered events, an unpaid asynchronous checkout, failed renewal, cancellation at period end, immediate cancellation, partial/full refund, dispute and early fraud warning.
5. First build the separate sandbox Windows installer described below and test the full payment-to-desktop flow. After sandbox sign-off, build the production candidate with the production public key. Test installation, scan, quarantine/restore, read-only Windows views, paid monitoring, vault, Nova key storage, paid-license activation and online renewal. Verify the three-day offline expiry and that explicit revocation disables monitoring. Review false positives before moving files.
6. Review the existing commercial terms before sale: the repository still contains a governing-law placeholder, and the support address and refund process need owner verification. Ensure account deletion/data-access requests can be handled. No legal jurisdiction or tax registration is assumed here.
7. Configure the equivalent live Stripe price, restricted key, customer portal and webhook at `https://sentivoguard.com/api/billing/webhook`. Upload the tested installer, update `SG_DOWNLOAD_URL` and explicitly enable `SG_DOWNLOAD_ENABLED` after approval. Deploy with checkout disabled, verify login and download, then enable billing and redeploy. Only perform a live charge when specifically authorized.

Stripe and the deployment must use the same mode. Signature failures return 400. Processing/storage failures return 503 so Stripe can retry. The event is marked complete only after successful reconciliation. Concurrent webhook processing uses a lease; an expired worker cannot delete a replacement lock.

## Isolated sandbox setup checklist

Provider configuration has not been completed by these source changes. The inspected connected Stripe account exposes live mode, not an authorized SentivoGuard sandbox. Existing Vercel Redis variables were shared across production/preview/development. Do not point the test app at that database.

| Provider | Exact setup required before a real test |
|---|---|
| Stripe sandbox | Create/select a dedicated sandbox and confirm the dashboard says sandbox/test. After approval, create the dedicated annual price above. Use only sandbox cards and customers. |
| Restricted key | Grant Customers write (also reads), Prices read, Checkout Sessions write (create/read/expire), Subscriptions read, Invoices read, Invoice Payments read, Charges read, and Billing Portal configuration read/session write. Dashboard permission group names can differ; verify every used endpoint in sandbox and do not grant refund or subscription writes to this server, which does not call them. Store the key only in the test server's sensitive settings. |
| Portal | Save a sandbox configuration; copy its `bpc_...` ID to `STRIPE_PORTAL_CONFIGURATION`. Enable payment method updates and invoices; enable subscription cancellation at period end; disable subscription updates/price changes. |
| Webhook | Register the exact test-host endpoint with the event list and API version above. Put that endpoint's signing secret into the test environment only. Verify it can reach the endpoint without a hosting login page; a protected Vercel preview is not automatically webhook-accessible. Do not reuse Orion Saint's webhook. |
| Resend | Add/verify a sender domain or authorized subdomain for SentivoGuard. Publish the DNS records Resend supplies, including DKIM and its SPF/return-path records; do not invent records. Confirm verified status. Create a sending-only key scoped to that domain, set `RESEND_FROM`, and prove verification/reset messages arrive at owned test inboxes. |
| Redis | Create a separate empty database with its own REST credentials. Test atomic EVAL, GETDEL, NX/EX leases and expiry on it. No production customer data should be copied. |
| Test host | Use a separate HTTPS origin, test-only variables and separate signing pair. Keep the private key server-side. A sandbox checkout still requires a test installer URL in `SG_DOWNLOAD_URL` and explicit `SG_DOWNLOAD_ENABLED=true` for the sandbox. Approval is required before creating/deploying this environment. |

Run `node --env-file=/secure/path/to/test.env tools/readiness.js` locally after securely loading the settings. The report prints booleans only; it does not contact Stripe, Redis or Resend. Do not paste secret values into tickets, chat, logs, screenshots or Git.

## Separate desktop sandbox build

Generate a disposable Ed25519 key pair in a secure location. Configure the private and public PEM in the isolated website; give the build process only the public PEM. From the source root:

```sh
npm run stage:sandbox -- https://YOUR-TEST-HOST /absolute/path/test-public.pem
cd out/sandbox-source
npm ci
npm run check
npm test
npm run build:win -- --publish never
```

The command refuses the production public key, production host, a private PEM, or an existing output directory. Its output uses `com.sentivoguard.sandbox`, the name `SentivoGuard Sandbox`, a separate application data directory, port 41731 and the pinned test origin. Production uses port 41730 and its original quarantine location. Runtime environment variables cannot replace the desktop public key or renewal origin. Renewal requests do not follow redirects.

Keep the sandbox installer separate from customer downloads. Record the source commit, version, SHA-256, bundled public-key fingerprint, tested Windows version, signing status and results. Rebuild the production candidate from the original production source configuration after testing; do not rename the sandbox installer as a production release. The publisher identity must match the eventual code-signing certificate; no certificate is configured by this change.

Use a clean Windows VM to install, launch, quit/restart, upgrade and uninstall. Confirm tray operation, port conflict errors, preservation of existing quarantine/vault data, and no production/sandbox data overlap. Confirm the account-issued sandbox license activates the sandbox app, cannot activate production, renews, and loses paid monitoring after revocation/expiry. An archive that builds or a Node test suite is not proof of an installed Windows release.

The verification workflow builds packages on Linux and Windows with `--publish never`, then runs the packaged executable in Electron's Node mode against disposable loopback/filesystem fixtures. The Windows job builds an unsigned NSIS candidate; it does not run its installer or publish it. Check that workflow's result for the exact source commit, then record the separate installed-application results above before treating any installer as a release.

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
