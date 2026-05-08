// SentivoGuard — Claude API client
// Three transport modes:
//   1. Electron  — secure IPC via window.sentivo.askNova(messages). Key lives in main process.
//   2. Browser   — direct fetch to api.anthropic.com using a key the user pasted into Settings.
//                  Requires the special "anthropic-dangerous-direct-browser-access: true" header.
//                  The key is stored in localStorage; this is fine for prototyping but in production
//                  you'd front this with a backend proxy.
//   3. Mock      — local keyword router used when neither of the above is configured.

SG.api = (function () {
  const NOVA_SYSTEM_PROMPT = `
You are Nova, the built-in AI security assistant for SentivoGuard, a complete
privacy and security desktop suite.

You are an expert in:
- All 14 SentivoGuard tools: Shield VPN, Nova AI, SentivoClean, SentivoVault,
  SentivoBlock, SentivoWatch, SentivoWall, SentivoChat, SentivoTransfer,
  SentivoDNS, SentivoHotspot, SentivoDrivers, SentivoDefend, Instinct Scanner.
- The Instinct scanner engine (7 scanners: npm, pip, folder, GitHub, Docker,
  Ruby gem, browser extension) and its verdict system (CLEAN / CAUTION / SUSPICIOUS).
- Quarantine commands: instinct quarantine file/npm/pip, list, restore.
- Cybersecurity threats: malware, ransomware, phishing, supply-chain, credential
  theft, zero-days, obfuscated code, cryptomining, persistence mechanisms.

Style:
- Plain language first; offer technical depth on request.
- Be direct, no hedging.
- Reassure the user about privacy: scanning is on-device; only conversation
  text is sent to the Claude API.
- Format with **bold** and \`code\` markdown when it improves clarity.
`.trim();

  const MODEL = "claude-sonnet-4-20250514";

  function getMode() {
    if (typeof window !== "undefined" && window.sentivo && window.sentivo.askNova) {
      return "electron";
    }
    const key = SG.store.get("apiKey", "");
    if (key) return "browser";
    return "mock";
  }

  function getKey() {
    return SG.store.get("apiKey", "");
  }

  function setKey(key) {
    SG.store.set("apiKey", (key || "").trim());
  }

  function clearKey() {
    SG.store.del("apiKey");
  }

  // ── Mode 2: direct browser fetch ───────────────────────────────────
  async function callBrowser(messages) {
    const key = getKey();
    if (!key) return { ok: false, error: "no_key" };

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type":      "application/json"
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 1000,
        system:     NOVA_SYSTEM_PROMPT,
        messages
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return { ok: false, error: `http_${resp.status}`, detail: errText.slice(0, 400) };
    }
    const json  = await resp.json();
    const text  = json.content?.[0]?.text || "";
    const usage = json.usage || {};
    return { ok: true, text, usage };
  }

  // ── Mode 1: Electron IPC ───────────────────────────────────────────
  async function callElectron(messages) {
    return await window.sentivo.askNova(messages);
  }

  // ── Mode 3: Mock keyword router ────────────────────────────────────
  function mockReply(prompt) {
    const p = (prompt || "").toLowerCase();
    if (p.includes("instinct") || p.includes("scanner"))
      return "**Instinct** runs 7 parallel scanners — `npm`, `pip`, folder, GitHub, Docker, Ruby gem, and browser extension. Each returns a verdict:\n\n• **CLEAN** — exit 0, no findings\n• **CAUTION** — exit 0, only medium/low\n• **SUSPICIOUS** — exit 1, at least one HIGH";
    if (p.includes("caution") || p.includes("verdict"))
      return "**CAUTION** = medium/low findings only, exit 0. CI passes; review recommended. Common triggers: outbound HTTP from a build step, container running as root, `unsafe-eval` in a manifest CSP.";
    if (p.includes("vpn") || p.includes("shield"))
      return "Your **Shield VPN** is connected to **" + (SG.vpnState?.server || "Frankfurt") + "** with WireGuard + AES-256-GCM. Kill switch is on.";
    if (p.includes("npm") || p.includes("quarantine"))
      return "Run `instinct quarantine npm <package>` — moves to `~/.instinct/quarantine/`, removes execute bits, runs `npm uninstall`. Reversible via `instinct quarantine restore`.";
    if (p.includes("password") || p.includes("strong"))
      return "Use a **passphrase** (4+ random words) for the master, then 16+ char generated values per site. Your vault has " + (SG.vaultItems?.length || 0) + " entries — looking now.";
    if (p.includes("port") || p.includes("firewall"))
      return "Block inbound: **445** (SMB), **3389** (RDP, IP-allowlisted only), **23** (Telnet), **135-139** (NetBIOS).";
    if (p.includes("price") || p.includes("plan") || p.includes("upgrade"))
      return "**Plus** ($49/yr) unlocks Nova, Vault, Chat, DoH DNS, all VPN servers, 5 devices. **Ultimate** ($99/yr or $179 lifetime) adds Transfer, Hotspot, Drivers, 5M Nova tokens, unlimited devices.";
    if (p.length < 8 || p.includes("hi") || p.includes("hello"))
      return "Hey! Ask about a tool, paste an error, or tell me what you're seeing.";
    return "Note: **mock mode** is active because no Anthropic API key is configured. Open **Settings** and paste a key (`sk-ant-…`) to get real responses.\n\nQuick stats from your suite: VPN on, Vault has " + (SG.vaultItems?.length || 0) + " entries, last scan flagged 2 high findings.";
  }

  async function callMock(messages) {
    const last = messages[messages.length - 1]?.content || "";
    // Approximate the Anthropic latency so the typing dots feel natural.
    await new Promise(r => setTimeout(r, 600 + Math.random() * 500));
    const text = mockReply(last);
    return {
      ok: true,
      text,
      mock: true,
      usage: {
        input_tokens:  Math.round(last.length / 3.4),
        output_tokens: Math.round(text.length / 3.4)
      }
    };
  }

  async function ask(messages) {
    const mode = getMode();
    try {
      if (mode === "electron") return await callElectron(messages);
      if (mode === "browser")  return await callBrowser(messages);
      return await callMock(messages);
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  return {
    ask,
    getMode,
    getKey,
    setKey,
    clearKey,
    MODEL
  };
})();
