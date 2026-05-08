// SG.backend — real-OS bridge.
// On boot: pings /api/health. If reachable, sets SG.backend.available = true.
// Views check this flag to switch between real and mock implementations.

SG.backend = (function () {
  let state = {
    available:    false,
    capabilities: {},
    platform:     null,
    version:      null,
    error:        null,
    checked:      false
  };

  async function probe() {
    try {
      const r = await fetch("/api/health", { method: "GET" });
      if (!r.ok) throw new Error("http_" + r.status);
      const j = await r.json();
      state = {
        available:    !!j.ok,
        capabilities: j.capabilities || {},
        platform:     j.platform,
        version:      j.version,
        error:        null,
        checked:      true
      };
    } catch (e) {
      state = {
        available:    false,
        capabilities: {},
        platform:     null,
        version:      null,
        error:        e.message,
        checked:      true
      };
    }
    document.dispatchEvent(new CustomEvent("sg:backend"));
    return state;
  }

  async function call(path, opts) {
    const r = await fetch(path, opts);
    const j = await r.json().catch(() => ({ ok: false, error: "bad_json" }));
    return j;
  }

  // Public API — every method falls back gracefully if backend is offline.
  return {
    get state() { return state; },
    isReady:    () => state.checked,
    isReal:     () => state.available,

    probe,

    async getConnections() {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/connections", { method: "GET" });
    },

    async cleanScan() {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/clean/scan", { method: "GET" });
    },

    async cleanRun(ids) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/clean/run", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ ids })
      });
    },

    async scanFolder(target) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/scan/folder", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ target })
      });
    },

    async scanNpm(target) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/scan/npm", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ target })
      });
    },

    async getDiskPreset() {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/scan/disk/preset", { method: "GET" });
    },

    // ── Quarantine + Whitelist ──
    async quarantineList() {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/quarantine", { method: "GET" });
    },

    async quarantine(filePath, reason, finding) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/quarantine", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ path: filePath, reason, finding })
      });
    },

    async quarantineBulk(items) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/quarantine/bulk", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ items })
      });
    },

    async quarantineRestore(id, force = false) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/quarantine/restore", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ id, force })
      });
    },

    async quarantineDelete(id) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/quarantine/delete", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ id })
      });
    },

    async whitelistList() {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/whitelist", { method: "GET" });
    },

    async whitelistAdd(filePath) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/whitelist", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ path: filePath })
      });
    },

    async whitelistRemove(filePath) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/whitelist/remove", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ path: filePath })
      });
    },

    // ── VirusTotal ──
    async vtStatus() {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/virustotal/status", { method: "GET" });
    },
    async vtSetKey(key) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/virustotal/key", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ key })
      });
    },
    async vtClearKey() {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/virustotal/key", { method: "DELETE" });
    },
    async vtLookup(arg) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/virustotal/lookup", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify(typeof arg === "string" ? { sha256: arg } : arg)
      });
    },

    async verifyLicense(token) {
      if (!state.available) return { ok: false, error: "no_backend" };
      return call("/api/license/verify", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ token })
      });
    },

    /**
     * Streaming disk scan.
     *   opts: { quick: true } or { target: "<path>" }
     *   onEvent(ev): callback per { type, ... } NDJSON line
     * Returns: { promise, abort } — call abort() to cancel.
     */
    scanDisk(opts, onEvent) {
      if (!state.available) {
        onEvent && onEvent({ type: "error", error: "no_backend" });
        return { promise: Promise.resolve(), abort: () => {} };
      }

      const ctrl = new AbortController();
      const promise = (async () => {
        let resp;
        try {
          resp = await fetch("/api/scan/disk", {
            method:  "POST",
            headers: { "content-type": "application/json" },
            body:    JSON.stringify(opts || {}),
            signal:  ctrl.signal
          });
        } catch (e) {
          if (e.name !== "AbortError") onEvent && onEvent({ type: "error", error: e.message });
          return;
        }
        if (!resp.ok || !resp.body) {
          onEvent && onEvent({ type: "error", error: "http_" + resp.status });
          return;
        }
        const reader  = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (!line) continue;
              try { onEvent && onEvent(JSON.parse(line)); }
              catch { /* malformed line, skip */ }
            }
          }
        } catch (e) {
          if (e.name !== "AbortError") onEvent && onEvent({ type: "error", error: e.message });
        }
      })();

      return {
        promise,
        abort: () => { try { ctrl.abort(); } catch {} }
      };
    }
  };
})();
