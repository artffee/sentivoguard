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

The members page offers Plus at $49 USD/year through hosted Stripe Checkout. Checkout is disabled until configuration is complete and `SG_BILLING_ENABLED=true`. An explicit `SG_STRIPE_MODE` must match the restricted key; live keys are rejected in Vercel previews and development. Webhooks verify signatures, reconcile current subscriptions and grant access only for paid coverage. A redirect to the success page cannot grant a license. The explicitly configured Stripe customer portal remains available to existing customers when new sales are disabled.

See [deployment and migration](docs/deployment.md) for required settings, webhook events, test cases and remaining release work. `.env.example` lists variable names without credentials. Put secrets in Vercel's sensitive environment settings, never in Git or desktop packages.

## Desktop licenses

Licenses use Ed25519 signatures. Only the website has the private key. The desktop includes `server/license-public.pem`, validates the signature locally and renews paid access online. A lease lasts at most three days, bounded by paid subscription coverage. An explicit rejection ends access; a temporary outage permits use only until the signed expiry.

The `devices` field describes the plan allowance; hardware binding is not implemented. Standard and Ultimate IDs are supported only for migration of verified existing subscriptions; new checkout offers Plus.

## Build

```sh
npm run build:win
```

Website downloads stay disabled until `SG_DOWNLOAD_ENABLED=true` and `SG_DOWNLOAD_URL` points to an approved installer. An old saved URL alone cannot enable downloads or checkout. The installer must contain the public verification key matching the production signing key. Never package a private key or website `.env` file. Windows installation, OS-specific tools and code signing must be validated on Windows before publishing. An unsigned development build is not a verified production release. Pass `-- --publish never` when making a local test build.

For sandbox testing, prepare a separate source tree with the test server's public key:

```sh
npm run stage:sandbox -- https://YOUR-TEST-HOST /absolute/path/test-public.pem
cd out/sandbox-source
npm ci
npm run build:win -- --publish never
```

The staging command also works from a source ZIP. It refuses the production key or origin and gives the sandbox a separate app identity, data directory and loopback port. It copies only source files and the public key; it does not configure providers or deploy. The production desktop stays pinned to `https://sentivoguard.com`. The backend starts from a real user-data directory, including when its code lives inside `app.asar`.

Run `npm run check:config` in a securely configured server environment for a value-free readiness report. It checks local settings only; successful diagnostics do not prove provider configuration or sandbox payments.

## Checks in this change

- 52 Node tests cover account persistence, revocation, password reset, origin checks, billing reconciliation, checkout retries, webhook signatures, local API isolation, scan streaming, quarantine integrity, cancellation during sales pauses, test/live separation, desktop startup, sandbox staging and builder configuration.
- JavaScript syntax checks run in GitHub Actions alongside the tests.
- CI also builds on Linux and Windows with publishing disabled, then tests the actual packaged backend using `npm run test:packaged -- <unpacked-executable>`. This checks ASAR startup, authenticated API access, unlicensed monitoring rejection and a real fixture scan. It does not install the application or open its GUI, and it publishes no installer.
- Production dependency audit: zero reported vulnerabilities at verification time.

Tests use disposable keys and a mocked Redis/Stripe boundary. They do not establish a completed Stripe payment, production email delivery, Windows installer compatibility, or complete malware detection.
