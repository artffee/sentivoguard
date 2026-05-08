# SentivoGuard

Complete privacy & security desktop suite — 14 integrated tools in one app.
Native Windows installer with bundled real-time scanner, quarantine, VirusTotal lookup, and AES-encrypted vault.

## Quick start

### As a developer (browser dev)

```sh
npm run serve            # Node backend on http://127.0.0.1:4173
# open http://127.0.0.1:4173 in any browser
```

### As an end user (Electron desktop)

```sh
npm install              # installs Electron once (~120 MB)
npm start                # launches the SentivoGuard window
```

The Electron main process spawns the backend on a private port (41730), waits
for `/api/health`, then loads the renderer. A system-tray icon keeps the
real-time watcher running when the window is closed.

## Build the installer

```sh
npm run build:win        # produces dist/SentivoGuard Setup 2.1.0.exe (NSIS)
npm run build:mac        # produces dist/SentivoGuard-2.1.0.dmg
```

The Windows build is **unsigned** by default — Windows SmartScreen will warn
on first run. To sign in production, get an EV code-signing certificate from
DigiCert / Sectigo (~$200/yr) and configure
[electron-builder code signing](https://www.electron.build/code-signing).

## Licensing

SentivoGuard is **paid software**. End users get an `.exe` installer + license
key after Stripe checkout. The desktop app verifies the key locally before
unlocking Plus / Ultimate features.

### How it works

- **License keys are JWTs** (HS256 in this prototype, switch to RS256 for prod).
- The signing secret lives only on your billing backend, set via
  `SG_LICENSE_SECRET` env var. The desktop app holds only the verification
  side ([server/license.js](./server/license.js)).
- After a successful Stripe checkout, your webhook calls
  `tools/issue-license.js` to mint a JWT and email it to the customer.
- The customer pastes the JWT into **Settings → License key** in the app.
  Backend verifies the signature and (optionally) calls home for revocation.

### Issue a license (manual / testing)

```sh
node tools/issue-license.js you@example.com plus 365
# → eyJhbGciOiJIUzI1NiIs… paste this into the app
```

Plans: `free`, `standard`, `plus`, `ultimate` — see
[server/license.js](./server/license.js) for what each unlocks.

### Production checklist

1. Set a strong `SG_LICENSE_SECRET` env var on the billing backend
2. Switch alg from HS256 to RS256 — embed only the public key in the app
3. Add a revocation list endpoint (so refunds invalidate keys)
4. Bind license to device fingerprint (hardware ID) to prevent sharing
5. Sign the .exe with an EV code-signing cert
6. Upload to your CDN / Stripe customer portal for download

## What's actually functional

| Component                     | Status   | Notes |
|-------------------------------|----------|-------|
| Disk Scan (streaming, real)   | ✅ real   | walks 50k+ files, NDJSON stream, all 8 threat categories |
| Quarantine + restore + delete | ✅ real   | SHA-256 verified, system-path guards, reversible |
| Whitelist                     | ✅ real   | scanners skip whitelisted paths/dirs |
| VirusTotal lookup             | ✅ real   | per-finding hash check, free-tier rate limited |
| Real-time file watcher        | ✅ real   | fs.watch on Downloads/Temp/AppData, SSE stream |
| SentivoWatch (netstat)        | ✅ real   | PowerShell-backed per-process connections |
| SentivoClean                  | ✅ real   | real cache sizes + safe deletion (allowlist only) |
| Nova AI                       | ✅ real   | Claude Sonnet 4 via Settings API key (mock fallback) |
| Vault                         | ✅ real   | AES-256-GCM + PBKDF2-200k via Web Crypto, master password |
| License gating                | ✅ real   | JWT verification, plan-based feature unlock |
| Instinct npm + folder scan    | ✅ real   | Node std-lib only, 7 threat categories, verdict + exit code |
| Activity feed (live)          | ✅ real   | persisted, all real actions logged |
| Persistence (all settings)    | ✅ real   | localStorage with debounced flush |
| Shield VPN                    | UI only  | needs WireGuard kernel driver — placeholder |
| SentivoBlock / Wall / Defend  | UI only  | need OS-level integration |
| Instinct pip/github/gem/docker/extension | UI only | each is a future Node port |

## Layout

```
sentivoguard/
├── main.js                 # Electron main: spawns backend, system tray, single-instance lock
├── preload.js              # Secure context bridge (window.sentivo)
├── .server.js              # Node HTTP backend — static + /api/* endpoints
├── package.json            # electron-builder NSIS config
├── server/
│   ├── license.js          # JWT sign/verify (shared with tools/issue-license.js)
│   ├── quarantine.js       # SHA-256 manifest, safe-path guards, restore
│   ├── tool-virustotal.js  # VT v3 client, rate limiter, disk cache
│   ├── tool-watcher.js     # fs.watch daemon + pub/sub
│   ├── tool-netstat.js     # PowerShell-backed connection list
│   ├── tool-clean.js       # cache enumeration + safe deletion
│   ├── scanner-disk.js     # streaming async generator
│   ├── scanner-folder.js   # recursive walker
│   ├── scanner-npm.js      # package.json + source pattern audit
│   ├── walker.js           # bounded fs.walk + dirSize
│   └── patterns.js         # 7 threat categories + Windows-shell variants
├── tools/
│   └── issue-license.js    # CLI: mint a JWT key (production: run on billing backend)
├── styles/                 # main.css · dashboard.css · tools.css · nova.css
└── js/
    ├── store.js            # localStorage KV with debounced writes
    ├── crypto.js           # PBKDF2 + AES-GCM (Web Crypto)
    ├── api.js              # Anthropic Messages client (Electron / browser / mock)
    ├── backend.js          # /api/* fetch wrappers
    ├── license.js          # license activate/deactivate/applyToUser
    ├── data.js             # static catalogs + hydrated mutable state
    ├── activity.js         # logger + ring buffer
    ├── realtime.js         # SSE subscriber → activity feed
    ├── router.js           # hash router + DOM helper
    ├── app.js              # bootstrap (probe → license → render)
    ├── nova.js             # chat panel
    ├── dashboard.js        # hero + 14 tool cards + activity
    ├── diskscan.js         # streaming progress + findings + Quarantine/VT/Whitelist actions
    ├── quarantine.js       # quarantine + whitelist views
    ├── instinct.js         # 7-scanner UI (npm + folder real, rest mock)
    ├── vpn.js              # Shield VPN view
    ├── vault.js            # encrypted vault (master-password gated)
    ├── watch.js            # real-time per-process connections
    ├── clean.js            # cache cleaner
    ├── settings.js         # license + Anthropic + VT keys + danger zone
    └── tools.js            # remaining 8 tool stubs
```

## Brand

- Palette: deep forest-green on near-black (`#0a0f0c` → `#74c69d`)
- Typography: system stack + JetBrains Mono for status / IPs / hashes
- Pulse animation on live indicators
