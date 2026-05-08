// SentivoGuard — persistence layer
// Tiny KV store backed by localStorage with debounced writes.
// In Electron the same API works (renderer has localStorage); for stronger
// guarantees you can swap the read/write pair to use IPC -> userData JSON.

window.SG = window.SG || {};

SG.store = (function () {
  const KEY = "sentivoguard:v1";
  let data = {};
  let timer = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("store: parse failed, resetting", e);
      data = {};
    }
  }

  function flush() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("store: write failed", e);
    }
    timer = null;
  }

  function scheduleFlush() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 200);
  }

  // Initial load is synchronous so consumers can read on first import.
  load();
  // Flush before unload in case a write is pending.
  window.addEventListener("beforeunload", () => { if (timer) flush(); });

  return {
    get(key, fallback) {
      return key in data ? data[key] : fallback;
    },
    set(key, value) {
      data[key] = value;
      scheduleFlush();
    },
    del(key) {
      delete data[key];
      scheduleFlush();
    },
    flush,
    reset() {
      data = {};
      flush();
    },
    // For diagnostics / settings page.
    snapshot() {
      return JSON.parse(JSON.stringify(data));
    }
  };
})();
