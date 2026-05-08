// Real-time client — subscribes to the backend's SSE stream and pushes
// notable events into the activity feed.

SG.realtime = (function () {
  let es = null;
  let connected = false;
  let lastStatus = null;

  function start() {
    if (es) return;
    if (typeof EventSource === "undefined") return;
    if (!SG.backend.isReal()) return;

    try {
      es = new EventSource("/api/realtime/events");
    } catch {
      return;
    }

    es.onopen = () => {
      connected = true;
      document.dispatchEvent(new CustomEvent("sg:realtime", { detail: { status: "connected" } }));
    };

    es.onerror = () => {
      connected = false;
      document.dispatchEvent(new CustomEvent("sg:realtime", { detail: { status: "disconnected" } }));
      // EventSource auto-reconnects; nothing to do.
    };

    es.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); }
      catch { return; }
      handle(ev);
    };
  }

  function stop() {
    if (es) { es.close(); es = null; }
    connected = false;
  }

  function isConnected() { return connected; }
  function getStatus() { return lastStatus; }

  function handle(ev) {
    if (ev.type === "hello") {
      lastStatus = ev.status;
      document.dispatchEvent(new CustomEvent("sg:realtime", { detail: { status: "ready" } }));
      return;
    }

    if (ev.type === "started" || ev.type === "stopped") {
      SG.activity_log.log("info", "◐",
        "<b>Real-time monitor</b> · " + ev.type +
        (ev.paths ? " · watching " + ev.paths.length + " paths" : ""));
      return;
    }

    if (ev.type === "error") {
      // Watcher couldn't start on a path — surface quietly.
      return;
    }

    if (ev.type === "file_event") {
      const findings = ev.findings || [];
      const high = findings.find(f => f.severity === "HIGH");
      const med  = findings.find(f => f.severity === "MEDIUM");
      const top  = high || med || findings[0];

      const fname = ev.name || ev.path;
      const escaped = escapeHtml(fname);
      const pathShort = (ev.path || "").length > 60
        ? "…" + ev.path.slice(-60)
        : ev.path;

      if (top) {
        const t = top.severity === "HIGH"   ? "danger"
                : top.severity === "MEDIUM" ? "warn"
                :                              "info";
        const i = top.severity === "HIGH"   ? "X"
                : top.severity === "MEDIUM" ? "!"
                :                              "•";
        SG.activity_log.log(t, i,
          "<b>Real-time</b> · new file flagged · <b>" + escaped + "</b> · " +
          top.severity + " · " + escapeHtml(top.message) +
          " · <span class='mono tiny'>" + escapeHtml(pathShort) + "</span>");
        // Optional desktop notification on HIGH (only if user has granted).
        if (top.severity === "HIGH" && "Notification" in window &&
            Notification.permission === "granted") {
          new Notification("SentivoGuard · HIGH severity file", {
            body: top.message + "\n" + ev.path,
            silent: false
          });
        }
      }
      // Note: we deliberately don't log low-noise file events to avoid spam.
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  return { start, stop, isConnected, getStatus };
})();
