# SentivoGuard

A Windows beta security companion: heuristic disk and package inspection, reversible quarantine, selected-folder monitoring, read-only Windows security status, cache cleanup, and a local encrypted vault. It complements Windows Defender; a scan with no findings is not a guarantee of safety. VPN, messaging, transfer and hotspot features are unavailable.

## Develop and verify

Use Node.js 24 or newer.

```sh
npm ci
npm run check
npm test
npm start
```

`npm run serve` starts the desktop backend at `http://127.0.0.1:4173`. Open that exact address to establish its local session. APIs require that session and reject foreign origins. The Electron app starts its own loopback server. It never needs the website's Redis, Stripe, email, or signing credentials.

Nova runs through Electron's main process with a user-provided Anthropic key stored using operating-system encryption. Provider usage is billed separately. Nova is unavailable in ordinary browser mode. VirusTotal lookups send hashes only and require the user's key.

## Website and billing

Vercel serves the public pages and Node API routes. Accounts require Redis; there is no cookie-only fallback. Passwords are scrypt-hashed. Browser cookies contain random session tokens, never password hashes. Email verification and password reset use expiring, single-use links.

The members page offers Plus at $49 USD/year through hosted Stripe Checkout. Checkout is disabled until configuration is complete and `SG_BILLING_ENABLED=true`. Webhooks verify signatures, reconcile current subscriptions and grant access only for paid coverage. A redirect to the success page cannot grant a license. The Stripe customer portal handles subscription management.

See [deployment and migration](docs/deployment.md) for required settings, webhook events, test cases and remaining release work. `.env.example` lists variable names without credentials. Put secrets in Vercel's sensitive environment settings, never in Git or desktop packages.

## Desktop licenses

Licenses use Ed25519 signatures. Only the website has the private key. The desktop includes `server/license-public.pem`, validates the signature locally and renews paid access online. A lease lasts at most three days, bounded by paid subscription coverage. An explicit rejection ends access; a temporary outage permits use only until the signed expiry.

The `devices` field describes the plan allowance; hardware binding is not implemented. Standard and Ultimate IDs are supported only for migration of verified existing subscriptions; new checkout offers Plus.

## Build

```sh
npm run build:win
```

The installer must contain the public verification key matching the production signing key. Never package a private key or website `.env` file. Windows installation, OS-specific tools and code signing must be validated on Windows before publishing. An unsigned development build is not a verified production release.

## Checks in this change

- 30 Node tests cover account persistence, revocation, password reset, origin checks, billing reconciliation, checkout retries, webhook signatures, local API isolation, scan streaming and quarantine integrity.
- JavaScript syntax checks run in GitHub Actions alongside the tests.
- Production dependency audit: zero reported vulnerabilities at verification time.

Tests use disposable keys and a mocked Redis/Stripe boundary. They do not establish a completed Stripe payment, production email delivery, Windows installer compatibility, or complete malware detection.
