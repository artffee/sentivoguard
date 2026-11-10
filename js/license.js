// SentivoGuard — license module (frontend).
// On boot:
//   - If a valid license is stored, hydrate SG.user from its claims.
//   - If not, the renderer is in "Free" mode and Settings prompts for activation.
// Expose a public API used by Settings + the Vault/Nova gates.

SG.license = (function () {
  let cached = null;            // { token, email, plan, devices, expires, tier }

  function load() {
    if (cached && cached.expires * 1000 > Date.now()) return cached;
    cached = null;
    const stored = SG.store.get("license", null);
    if (stored && stored.token && stored.expires &&
        stored.expires * 1000 > Date.now()) {
      cached = stored;
      return cached;
    }
    return null;
  }

  function persist(info) {
    cached = info;
    if (info) SG.store.set("license", info);
    else      SG.store.del("license");
  }

  // Hydrate SG.user from the license payload so existing UI reads correct values.
  function applyToUser() {
    const lic = load();
    if (lic) {
      SG.user.plan    = capitalize(lic.plan);
      SG.user.email   = lic.email;
      SG.user.devices = lic.devices;
      SG.user.novaTokensLimit = lic.tier?.novaTokens || SG.user.novaTokensLimit;
      SG.user.licensed = true;
    } else {
      SG.user.plan     = "Free";
      SG.user.devices  = 1;
      SG.user.licensed = false;
    }
    SG.persist("user");
  }

  async function activate(token) {
    if (!SG.backend.isReal()) {
      return { ok: false, error: "backend_offline",
               detail: "Activation requires the SentivoGuard service to be running. Try restarting the app." };
    }
    const r = await SG.backend.verifyLicense(token);
    if (!r.ok) return { ok: false, error: r.error };

    const info = {
      token: r.token || token,
      email:   r.email,
      plan:    r.plan,
      devices: r.devices,
      expires: r.expires,
      tier:    r.tier,
      activatedAt: Date.now()
    };
    persist(info);
    applyToUser();
    SG.activity_log.log("ok", "✓",
      "<b>License</b> · activated for <b>" + escapeHtml(r.email) +
      "</b> · " + capitalize(r.plan));
    return { ok: true, info };
  }

  async function deactivate() {
    await fetch("/api/license/deactivate", { method: "POST", headers: {"content-type":"application/json"}, body: "{}" });
    persist(null);
    applyToUser();
    SG.activity_log.log("info", "↓", "<b>License</b> · removed");
  }

  // Returns true if the current license unlocks `feature`.
  // Features: "vault" "realtime" "ultimate".
  function has(feature) {
    const lic = load();
    if (!lic || !lic.tier) return false;
    return !!lic.tier[feature];
  }

  function info() {
    const lic = load();
    if (!lic) return { licensed: false };
    return {
      licensed:  true,
      email:     lic.email,
      plan:      lic.plan,
      devices:   lic.devices,
      expiresAt: lic.expires * 1000,
      daysLeft:  Math.max(0, Math.floor((lic.expires * 1000 - Date.now()) / 86_400_000))
    };
  }

  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  async function initialize() {
    const stored = SG.store.get('license', null);
    cached = null;
    if (stored?.token && SG.backend.isReal()) {
      const r = await SG.backend.verifyLicense(stored.token);
      if (r.ok) persist({ ...r, token: r.token || stored.token });
      else persist(null);
    } else persist(null);
    applyToUser();
    document.querySelector('.user-name').textContent = SG.user.licensed ? SG.user.email : 'Local account';
    document.querySelector('.user-plan').textContent = SG.user.plan;
    document.querySelector('.brand-sub').textContent = SG.user.plan + ' · v' + (SG.backend.state.version || 'unknown');
  }
  setInterval(async () => {
    const stored = SG.store.get('license', null);
    if (!stored?.token || !SG.backend.isReal()) return;
    try {
      const r = await SG.backend.verifyLicense(stored.token);
      persist(r.ok ? { ...r, token: r.token || stored.token } : null);
      applyToUser();
    } catch { /* Local expiry still applies. */ }
  }, 30 * 60 * 1000);
  return { initialize, load, applyToUser, activate, deactivate, has, info };
})();
