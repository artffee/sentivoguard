// SentivoGuard — data layer
// STATIC catalogs are defined inline. MUTABLE state is hydrated from SG.store
// with the inline values used as first-run defaults.

window.SG = window.SG || {};

// ─── Static catalogs (read-only) ──────────────────────────────────────────

SG.tools = [
  { id: "instinct",  name: "Instinct Scanner", cat: "Security", icon: "◈",
    desc: "7-scanner parallel engine: npm, pip, folder, GitHub, Docker, Ruby gem, browser extension.",
    tier: "Free", status: "ok", statusText: "Last scan: 14 min ago" },

  { id: "vpn",       name: "Shield VPN", cat: "VPN", icon: "◐",
    desc: "WireGuard-based VPN — AES-256, kill switch, split tunneling.",
    tier: "Standard", status: "ok", statusText: "Connected · Frankfurt" },

  { id: "nova",      name: "Nova AI", cat: "AI", icon: "★",
    desc: "Voice-capable AI security assistant powered by Claude Sonnet 4.",
    tier: "Plus", status: "ok", statusText: "1M tokens / mo" },

  { id: "clean",     name: "SentivoClean", cat: "System", icon: "◇",
    desc: "Deep cleanup: temp files, browser cache, Windows logs, privacy traces.",
    tier: "Free", status: "warn", statusText: "2.4 GB reclaimable" },

  { id: "vault",     name: "SentivoVault", cat: "Privacy", icon: "▣",
    desc: "AES-256 password manager with browser autofill.",
    tier: "Plus", status: "ok", statusText: "47 entries · synced" },

  { id: "block",     name: "SentivoBlock", cat: "Privacy", icon: "⊘",
    desc: "DNS-level ad and tracker blocking system-wide.",
    tier: "Standard", status: "ok", statusText: "12,847 blocked today" },

  { id: "watch",     name: "SentivoWatch", cat: "Security", icon: "◉",
    desc: "Real-time network monitor — every TCP/UDP connection per process.",
    tier: "Standard", status: "ok", statusText: "23 active connections" },

  { id: "wall",      name: "SentivoWall", cat: "Security", icon: "▤",
    desc: "Windows Firewall visual manager with per-app rules.",
    tier: "Plus", status: "ok", statusText: "12 rules active" },

  { id: "chat",      name: "SentivoChat", cat: "Privacy", icon: "▭",
    desc: "End-to-end encrypted messaging between SentivoGuard users.",
    tier: "Plus", status: "ok", statusText: "Zero-knowledge · NaCl" },

  { id: "transfer",  name: "SentivoTransfer", cat: "Privacy", icon: "⇌",
    desc: "Encrypted peer-to-peer file transfer with one-time keys.",
    tier: "Ultimate", status: "off", statusText: "Ultimate only" },

  { id: "dns",       name: "SentivoDNS", cat: "Privacy", icon: "⌖",
    desc: "Custom DNS with DNS-over-HTTPS support.",
    tier: "Plus", status: "ok", statusText: "Cloudflare 1.1.1.1" },

  { id: "hotspot",   name: "SentivoHotspot", cat: "VPN", icon: "⌒",
    desc: "Turn your PC into a protected WiFi access point sharing the VPN.",
    tier: "Ultimate", status: "off", statusText: "Ultimate only" },

  { id: "drivers",   name: "SentivoDrivers", cat: "System", icon: "⚙",
    desc: "Driver update scanner via WMI — silent install, no toolbars.",
    tier: "Ultimate", status: "off", statusText: "Ultimate only" },

  { id: "defend",    name: "SentivoDefend", cat: "Security", icon: "⌬",
    desc: "Windows Defender enhancement UI — schedules, exclusions, sensitivity.",
    tier: "Standard", status: "ok", statusText: "Real-time on" }
];

SG.scanners = [
  { id: "npm",    name: "npm Package",       module: "npm_audit.py",
    desc: "Audits package.json install hooks, source patterns, binary files, typosquatting." },
  { id: "pip",    name: "Python Package",    module: "pip_audit.py",
    desc: "setup.py execution analysis, source patterns, .pyd/.dll extension files." },
  { id: "folder", name: "Local Folder",      module: "folder_audit.py",
    desc: "7 categories: cred theft, exfil, exec, obfuscation, persistence, mining, ransomware." },
  { id: "github", name: "GitHub Repo",       module: "github_audit.py",
    desc: "Shallow-clones repo, scans Actions for injection, runs full folder scan." },
  { id: "gem",    name: "Ruby Gem",          module: "gem_audit.py",
    desc: "eval/system/HTTP/ENV theft/Marshal.load/Base64/native C extensions." },
  { id: "docker", name: "Docker Image",      module: "docker_audit.py",
    desc: "4-phase: inspect, layer history, layer tar extraction, secrets in env." },
  { id: "ext",    name: "Browser Extension", module: "extension_audit.py",
    desc: "CRX/XPI parsing, manifest permissions, CSP weaknesses, keylogger patterns." }
];

SG.scanScripts = {
  npm: [
    { d: 60,  t: "info",   l: "[i] Fetching npm registry metadata for left-pad@1.3.0..." },
    { d: 200, t: "dim",    l: "    package.json parsed · 1 dependency · 0 dev dependencies" },
    { d: 240, t: "dim",    l: "    Scanning install hooks (preinstall/postinstall)..." },
    { d: 250, t: "ok",     l: "[✓] No install hooks detected" },
    { d: 240, t: "dim",    l: "    Source pattern audit (eval/exec/HTTP/cred/obfuscation/mining)..." },
    { d: 320, t: "warn",   l: "[!] MEDIUM — outbound HTTP call detected in dist/index.js:42" },
    { d: 240, t: "dim",    l: "    Binary file scan (.node native modules)..." },
    { d: 200, t: "ok",     l: "[✓] No binary native modules" },
    { d: 220, t: "dim",    l: "    Typosquatting check against top 10k packages..." },
    { d: 200, t: "ok",     l: "[✓] No typosquatting flag" },
    { d: 280, t: "info",   l: "" },
    { d: 100, t: "warn",   l: "VERDICT: CAUTION  ·  1 medium finding  ·  exit 0" }
  ],
  pip: [
    { d: 60,  t: "info", l: "[i] Auditing pip package: requests==2.31.0" },
    { d: 220, t: "dim",  l: "    setup.py source scan..." },
    { d: 240, t: "ok",   l: "[✓] setup.py clean — no install-time exec" },
    { d: 200, t: "dim",  l: "    Binary extension scan (.pyd / .dll)..." },
    { d: 180, t: "ok",   l: "[✓] No suspicious binaries" },
    { d: 200, t: "info", l: "" },
    { d: 100, t: "ok",   l: "VERDICT: CLEAN  ·  0 findings  ·  exit 0" }
  ],
  folder: [
    { d: 50,  t: "info",   l: "[i] Scanning C:\\Users\\usivaylo\\Downloads\\suspect-tool\\..." },
    { d: 250, t: "dim",    l: "    47 files indexed · 12 .js · 3 .exe · 8 .json..." },
    { d: 280, t: "dim",    l: "    Category 1/7: credential theft patterns..." },
    { d: 240, t: "danger", l: "[X] HIGH — keytar.findPassword() exfil to remote in main.js:118" },
    { d: 240, t: "dim",    l: "    Category 2/7: network exfiltration..." },
    { d: 280, t: "danger", l: "[X] HIGH — POST to unknown C2 in worker.js:74" },
    { d: 240, t: "dim",    l: "    Category 3/7: code execution..." },
    { d: 280, t: "warn",   l: "[!] MEDIUM — child_process.exec(userInput) in cmd.js:33" },
    { d: 240, t: "dim",    l: "    Category 4/7: obfuscation..." },
    { d: 240, t: "warn",   l: "[!] MEDIUM — eval(atob(...)) pattern in loader.js:7" },
    { d: 240, t: "dim",    l: "    Category 5/7: persistence mechanisms..." },
    { d: 200, t: "ok",     l: "[✓] No persistence detected" },
    { d: 180, t: "dim",    l: "    Category 6/7: cryptocurrency mining..." },
    { d: 200, t: "ok",     l: "[✓] No mining patterns" },
    { d: 180, t: "dim",    l: "    Category 7/7: ransomware..." },
    { d: 200, t: "ok",     l: "[✓] No ransomware patterns" },
    { d: 200, t: "info",   l: "" },
    { d: 100, t: "danger", l: "VERDICT: SUSPICIOUS  ·  2 high · 2 medium  ·  exit 1" }
  ],
  github: [
    { d: 80,  t: "info", l: "[i] git clone --depth=1 https://github.com/example/repo..." },
    { d: 320, t: "dim",  l: "    340 files · stars: 2.1k · forks: 187 · age: 4 yr..." },
    { d: 220, t: "dim",  l: "    Scanning .github/workflows/ for injection..." },
    { d: 240, t: "ok",   l: "[✓] All Actions properly quoted" },
    { d: 200, t: "dim",  l: "    Running full folder scan..." },
    { d: 320, t: "ok",   l: "[✓] All categories clean" },
    { d: 180, t: "dim",  l: "    Cleaning temp dir..." },
    { d: 180, t: "info", l: "" },
    { d: 100, t: "ok",   l: "VERDICT: CLEAN  ·  0 findings  ·  exit 0" }
  ],
  gem: [
    { d: 80,  t: "info",   l: "[i] Auditing Ruby gem: rest-client-1.6.13..." },
    { d: 240, t: "dim",    l: "    Scanning .rb files for eval/system/backtick..." },
    { d: 240, t: "danger", l: "[X] HIGH — eval(remote_resp) in lib/connector.rb:88" },
    { d: 240, t: "dim",    l: "    ENV variable theft scan..." },
    { d: 240, t: "danger", l: "[X] HIGH — ENV.to_h sent to remote in lib/log.rb:44" },
    { d: 200, t: "dim",    l: "    Marshal.load / Base64 decode scan..." },
    { d: 200, t: "warn",   l: "[!] MEDIUM — Base64 decode of large payload at boot" },
    { d: 200, t: "info",   l: "" },
    { d: 100, t: "danger", l: "VERDICT: SUSPICIOUS  ·  2 high · 1 medium  ·  exit 1" }
  ],
  docker: [
    { d: 80,  t: "info", l: "[i] docker inspect node:18-alpine..." },
    { d: 280, t: "dim",  l: "    USER: 0 (root) · ports: 80, 443 · 12 layers · 187 MB" },
    { d: 240, t: "warn", l: "[!] MEDIUM — running as root" },
    { d: 240, t: "dim",  l: "    Layer history scan..." },
    { d: 240, t: "ok",   l: "[✓] No curl|bash detected" },
    { d: 220, t: "dim",  l: "    Layer tar extraction · scanning for keys/tokens..." },
    { d: 280, t: "ok",   l: "[✓] No private keys in layers" },
    { d: 200, t: "info", l: "" },
    { d: 100, t: "warn", l: "VERDICT: CAUTION  ·  1 medium finding  ·  exit 0" }
  ],
  ext: [
    { d: 80,  t: "info",   l: "[i] Parsing CRX v3: AdBlock-Pro.crx..." },
    { d: 240, t: "dim",    l: "    Manifest version: 3 · permissions count: 14..." },
    { d: 240, t: "danger", l: "[X] HIGH — \"debugger\" permission requested" },
    { d: 240, t: "danger", l: "[X] HIGH — \"nativeMessaging\" permission requested" },
    { d: 240, t: "warn",   l: "[!] MEDIUM — content_security_policy: unsafe-eval" },
    { d: 240, t: "dim",    l: "    JS keylogger / data-exfil pattern scan..." },
    { d: 280, t: "ok",     l: "[✓] No keylogger patterns" },
    { d: 200, t: "info",   l: "" },
    { d: 100, t: "danger", l: "VERDICT: SUSPICIOUS  ·  2 high · 1 medium  ·  exit 1" }
  ]
};

SG.scanDefaults = {
  npm:    "left-pad@1.3.0",
  pip:    "requests==2.31.0",
  folder: "C:\\Users\\usivaylo\\Downloads\\suspect-tool",
  github: "https://github.com/example/repo",
  gem:    "rest-client-1.6.13",
  docker: "node:18-alpine",
  ext:    "C:\\Users\\usivaylo\\AdBlock-Pro.crx"
};

SG.vpnServers = [
  { code: "DE-03", flag: "🇩🇪", name: "Frankfurt", country: "Germany",         ping: 23,  load: 34 },
  { code: "US-01", flag: "🇺🇸", name: "New York",  country: "United States",   ping: 87,  load: 56 },
  { code: "US-02", flag: "🇺🇸", name: "Dallas",    country: "United States",   ping: 142, load: 41 },
  { code: "GB-01", flag: "🇬🇧", name: "London",    country: "United Kingdom",  ping: 31,  load: 67 },
  { code: "FR-01", flag: "🇫🇷", name: "Paris",     country: "France",          ping: 28,  load: 22 },
  { code: "NL-01", flag: "🇳🇱", name: "Amsterdam", country: "Netherlands",     ping: 19,  load: 49 },
  { code: "JP-01", flag: "🇯🇵", name: "Tokyo",     country: "Japan",           ping: 198, load: 38 },
  { code: "SG-01", flag: "🇸🇬", name: "Singapore", country: "Singapore",       ping: 217, load: 45 },
  { code: "CA-01", flag: "🇨🇦", name: "Toronto",   country: "Canada",          ping: 96,  load: 29 },
  { code: "AU-01", flag: "🇦🇺", name: "Sydney",    country: "Australia",       ping: 244, load: 51 }
];

SG.connections = [
  { app: "chrome.exe",   pid: 4128, remote: "172.217.16.238", host: "google.com",         port: 443,  proto: "TCP", up: "1.2 KB/s", dn: "12.4 KB/s", flag: "🇺🇸" },
  { app: "code.exe",     pid: 8912, remote: "140.82.121.4",   host: "github.com",         port: 443,  proto: "TCP", up: "0.4 KB/s", dn: "2.1 KB/s",  flag: "🇺🇸" },
  { app: "spotify.exe",  pid: 6244, remote: "35.186.224.40",  host: "scdn.co",            port: 443,  proto: "TCP", up: "0.1 KB/s", dn: "184 KB/s", flag: "🇸🇪" },
  { app: "discord.exe",  pid: 7710, remote: "162.159.135.232",host: "discord.gg",         port: 443,  proto: "TCP", up: "0.6 KB/s", dn: "1.8 KB/s",  flag: "🇺🇸" },
  { app: "slack.exe",    pid: 5022, remote: "52.72.140.222",  host: "slack.com",          port: 443,  proto: "TCP", up: "0.2 KB/s", dn: "0.9 KB/s",  flag: "🇺🇸" },
  { app: "Notion.exe",   pid: 9344, remote: "104.18.34.219",  host: "notion.so",          port: 443,  proto: "TCP", up: "0.3 KB/s", dn: "1.4 KB/s",  flag: "🇺🇸" },
  { app: "node.exe",     pid: 1188, remote: "104.16.249.249", host: "registry.npmjs.org", port: 443,  proto: "TCP", up: "0.0 KB/s", dn: "0.0 KB/s",  flag: "🇺🇸" },
  { app: "OneDrive.exe", pid: 3304, remote: "13.107.42.13",   host: "onedrive.com",       port: 443,  proto: "TCP", up: "8.2 KB/s", dn: "1.1 KB/s",  flag: "🇺🇸" },
  { app: "Telegram.exe", pid: 7402, remote: "149.154.167.51", host: "telegram.org",       port: 443,  proto: "TCP", up: "0.1 KB/s", dn: "0.4 KB/s",  flag: "🇳🇱" },
  { app: "unknown.exe",  pid: 9988, remote: "45.227.253.99",  host: "??.bullhost.cc",     port: 8443, proto: "TCP", up: "12.8 KB/s", dn: "0.2 KB/s", flag: "🇷🇴", suspicious: true }
];

// ─── Mutable state (hydrated from store) ──────────────────────────────────

const userDefault = {
  email: "usivaylo@gmail.com",
  plan: "Plus",
  devices: 5,
  novaTokensUsed: 0,
  novaTokensLimit: 1_000_000
};
SG.user = SG.store.get("user", userDefault);

const vpnDefault = {
  connected: true,
  server: "Frankfurt",
  serverCode: "DE-03",
  ip: "185.180.12.241",
  protocol: "WireGuard",
  encryption: "AES-256-GCM",
  uptime: "1h 47m",
  upload: "12.4 MB",
  download: "187.2 MB",
  killSwitch: true,
  splitTunnel: false,
  customDns: true,
  autoConnect: true,
  blockIPv6: true
};
SG.vpnState = SG.store.get("vpnState", vpnDefault);

const vaultDefault = [
  { id: 1,  site: "GitHub",          url: "github.com",            user: "usivaylo",       pass: "K9#pLm2$xQv!nR8", strength: 95 },
  { id: 2,  site: "Anthropic",       url: "console.anthropic.com", user: "usivaylo@gmail.com", pass: "F7@nT4!yZx#mB6q", strength: 92 },
  { id: 3,  site: "Stripe",          url: "dashboard.stripe.com",  user: "u@sentivoguard.com", pass: "P3$wQz7!eR2#aV9", strength: 90 },
  { id: 4,  site: "AWS",             url: "console.aws.amazon.com",user: "sentivo-prod",   pass: "M8&hN5#kL1@dC4r", strength: 88 },
  { id: 5,  site: "Cloudflare",      url: "dash.cloudflare.com",   user: "usivaylo@gmail.com", pass: "R6%bV9!xT3$gH7w", strength: 86 },
  { id: 6,  site: "Netlify",         url: "app.netlify.com",       user: "usivaylo",       pass: "Z2!cF8#nQ4@mB1v", strength: 84 },
  { id: 7,  site: "DigitalOcean",    url: "cloud.digitalocean.com",user: "u@sentivo.com",  pass: "L5@dG2!fP7#wC9j", strength: 82 },
  { id: 8,  site: "Twitter / X",     url: "x.com",                 user: "@sentivoguard",  pass: "letmein2024",     strength: 18 },
  { id: 9,  site: "Bank of America", url: "bankofamerica.com",     user: "user_4421",      pass: "X7!vK3#nQ8$wT2c", strength: 91 },
  { id: 10, site: "Reddit",          url: "reddit.com",            user: "u/sentivoguard", pass: "Hunter2!",        strength: 32 }
];
SG.vaultItems = SG.store.get("vaultItems", vaultDefault);

const cleanDefault = [
  { id: "temp",       name: "Windows Temp Files",       bytes: "847 MB",  checked: true },
  { id: "cache",      name: "Chrome Cache",             bytes: "412 MB",  checked: true },
  { id: "ffcache",    name: "Firefox Cache",            bytes: "187 MB",  checked: true },
  { id: "edgecache",  name: "Edge Cache",               bytes: "94 MB",   checked: true },
  { id: "logs",       name: "Windows Event Logs",       bytes: "224 MB",  checked: true },
  { id: "prefetch",   name: "Prefetch",                 bytes: "47 MB",   checked: true },
  { id: "dnscache",   name: "DNS Cache",                bytes: "0.4 MB",  checked: true },
  { id: "thumbs",     name: "Thumbnail Cache",          bytes: "143 MB",  checked: true },
  { id: "recycle",    name: "Recycle Bin",              bytes: "318 MB",  checked: false },
  { id: "downloads",  name: "Old Downloads (>30 days)", bytes: "281 MB",  checked: false },
  { id: "history",    name: "Browser History (Privacy)",bytes: "12 MB",   checked: false },
  { id: "cookies",    name: "Tracking Cookies",         bytes: "3 MB",    checked: false }
];
SG.cleanCategories = SG.store.get("cleanCategories", cleanDefault);

const activityDefault = [
  { type: "ok",     icon: "✓", msg: "<b>Instinct Scanner</b> finished folder audit · CLEAN", ts: Date.now() - 14*60_000,    time: "14m ago" },
  { type: "warn",   icon: "!", msg: "<b>SentivoBlock</b> blocked <b>doubleclick.net</b> tracker", ts: Date.now() - 23*60_000, time: "23m ago" },
  { type: "info",   icon: "↓", msg: "<b>Shield VPN</b> reconnected to <b>Frankfurt (DE-03)</b>", ts: Date.now() - 60*60_000, time: "1h ago" },
  { type: "danger", icon: "X", msg: "<b>SentivoWatch</b> flagged outbound to <b>45.227.253.99</b> (Romania)", ts: Date.now() - 2*60*60_000, time: "2h ago" },
  { type: "ok",     icon: "✓", msg: "<b>SentivoVault</b> auto-filled credentials for <b>github.com</b>", ts: Date.now() - 3*60*60_000, time: "3h ago" }
];
SG.activity = SG.store.get("activity", activityDefault);

// Convenience: persist any of the named mutable slots after a mutation.
SG.persist = function (key) {
  if (SG[key] != null) SG.store.set(key, SG[key]);
};
