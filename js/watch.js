// SentivoWatch — real-time network monitor view.
// Pulls real per-process TCP connections from /api/connections; falls back to
// mock list (SG.connections) if the backend is unreachable.

SG.router.register("watch", function (view) {
  const el = SG.el;

  const realBadge = SG.backend.isReal()
    ? el("span", { class: "tag tag-ok" }, "REAL · " + (SG.backend.state.platform || "?"))
    : el("span", { class: "tag tag-warn" }, "MOCK MODE");

  // Layout: stats row + table + refresh control
  const statsRow = el("div", { class: "tool-grid-3", id: "watch-stats" });
  const head = el("div", { class: "conn-row head" },
    el("div", {}, ""),
    el("div", {}, "Process"),
    el("div", {}, "Remote"),
    el("div", {}, "Port"),
    el("div", {}, "State"),
    el("div", {}, "")
  );
  const table = el("div", { class: "connections" }, head);

  const refreshBtn = el("button", {
    class: "btn btn-ghost btn-sm",
    onclick: () => load()
  }, "↻ Refresh");

  view.append(
    statsRow,
    el("div", { class: "section-head" },
      el("h3", { style: "display:flex; gap: 10px; align-items:center;" },
        "Live connections · per process", realBadge),
      el("div", { class: "row", style: "gap: 8px;" },
        el("span", { class: "section-action", style: "cursor: default;" },
          el("span", { id: "watch-status", class: "tiny muted" }, "—")),
        refreshBtn
      )
    ),
    table
  );

  load();

  // Auto-refresh every 4s when backend is real and view is mounted.
  let timer = null;
  if (SG.backend.isReal()) {
    timer = setInterval(() => {
      // Only refresh if user is still on this view.
      if (document.body.contains(table)) load(true);
      else clearInterval(timer);
    }, 4000);
  }

  async function load(quiet) {
    const status = document.getElementById("watch-status");
    if (status && !quiet) status.textContent = "loading…";

    let conns;
    let source = "mock";

    if (SG.backend.isReal()) {
      const r = await SG.backend.getConnections();
      if (r.ok && Array.isArray(r.connections)) {
        conns = r.connections;
        source = r.source || "real";
      } else {
        conns = SG.connections;
        source = "mock (backend error: " + (r.error || "unknown") + ")";
      }
    } else {
      conns = SG.connections;
    }

    if (status) status.textContent = source;
    renderTable(conns);
    renderStats(conns);
  }

  function renderStats(conns) {
    const out = document.getElementById("watch-stats");
    out.innerHTML = "";
    const flagged = conns.filter(c => c.suspicious).length;
    const procs   = new Set(conns.map(c => c.app || c.host)).size;
    out.append(
      statCard("◉ Active connections", String(conns.length), "across " + procs + " processes"),
      statCard("⊘ Flagged outbound",   String(flagged),       "heuristic"),
      statCard("◐ Source",              SG.backend.isReal() ? "Real" : "Mock", SG.backend.state.platform || "—")
    );
  }

  function renderTable(conns) {
    // Wipe existing rows but keep the head
    const old = table.querySelectorAll(".conn-row:not(.head)");
    old.forEach(n => n.remove());

    if (!conns.length) {
      table.appendChild(
        el("div", {
          class: "muted",
          style: "padding: 20px; text-align: center; font-size: 12px;"
        }, "No active connections.")
      );
      return;
    }

    conns.forEach(c => {
      const isMock = !c.remoteHost && c.remote;
      const remoteHost = c.remoteHost || c.remote || c.host || "—";
      const remotePort = c.remotePort != null ? c.remotePort : c.port;
      const stateOrProto = c.state || c.proto || "—";
      const app = c.app || "—";
      const pid = c.pid != null ? c.pid : "—";

      table.appendChild(
        el("div", {
          class: "conn-row",
          style: c.suspicious ? "background: rgba(230,57,70,0.05);" : ""
        },
          el("div", { class: "conn-icon" }, c.flag || "●"),
          el("div", { class: "conn-app" },
            el("b", {}, app),
            el("span", {}, "PID " + pid)
          ),
          el("div", { class: "conn-remote" },
            isMock ? c.host : remoteHost,
            isMock ? el("span", {}, c.remote) : null
          ),
          el("div", { class: "mono tiny muted" }, remotePort != null ? String(remotePort) : "—"),
          el("div", { class: "tiny muted" }, stateOrProto),
          c.suspicious
            ? el("button", { class: "btn btn-sm btn-danger" }, "Block")
            : el("button", { class: "btn btn-sm btn-ghost" }, "Inspect")
        )
      );
    });
  }

  function statCard(label, value, sub) {
    return el("div", { class: "card" },
      el("div", { class: "qs-card-label" }, label),
      el("div", { class: "qs-card-value", style: "font-size: 22px; margin-top: 4px;" }, value),
      el("div", { class: "tiny muted", style: "margin-top: 2px;" }, sub)
    );
  }
}, { title: "SentivoWatch", sub: "Real-time network monitor · per-process connections" });
