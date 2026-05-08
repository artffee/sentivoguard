// SentivoGuard — bootstrap

(async function () {
  // Wire sidebar nav
  document.querySelectorAll(".nav-item").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const route = el.dataset.route;
      if (route) SG.router.go(route);
    });
  });

  // Top bar buttons
  document.getElementById("quick-scan").addEventListener("click", () => SG.router.go("instinct"));
  document.getElementById("open-nova").addEventListener("click",  () => SG.nova.open());

  // Backend health probe — must complete before first view render so views can
  // read SG.backend.isReal() correctly.
  await SG.backend.probe();
  injectBackendBadge();

  // Apply stored license (if any) to SG.user before views render.
  if (SG.license) SG.license.applyToUser();

  // Listen for nav events from the Electron tray menu.
  if (window.sentivo && window.sentivo.onNav) {
    window.sentivo.onNav((route) => SG.router.go(route));
  }

  // Subscribe to the real-time file event stream (SSE).
  // Real-time monitoring is a Plus/Ultimate feature — gate it.
  const realtimeAllowed = !SG.license || SG.license.has("realtime");
  if (SG.backend.isReal() && SG.realtime && realtimeAllowed) {
    SG.realtime.start();
    // Ask once for desktop-notification permission so HIGH events can pop up.
    if ("Notification" in window && Notification.permission === "default") {
      // Defer until a later interaction — Chrome rejects on-load asks.
      setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
    }
  }

  // Initial route from hash, fallback to dashboard
  const initial = (location.hash || "#dashboard").slice(1);
  SG.router.go(initial);

  // Init Nova chat panel
  SG.nova.init();

  // Token-counter ticker (mock dashboard liveness)
  setInterval(() => {
    document.querySelectorAll(".hero-stat-num").forEach(node => {
      const txt = node.textContent;
      if (/^[\d,]+$/.test(txt)) {
        const n = parseInt(txt.replace(/,/g, ""), 10);
        if (n > 100 && n < 50000 && Math.random() < 0.6) {
          node.textContent = (n + Math.floor(Math.random() * 5) + 1).toLocaleString();
        }
      }
    });
  }, 4500);

  // Re-render the backend badge on probe state changes.
  document.addEventListener("sg:backend", injectBackendBadge);

  function injectBackendBadge() {
    let badge = document.getElementById("backend-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "backend-badge";
      badge.className = "status-pill";
      badge.style.cssText = "margin-right: 6px; font-size: 11.5px;";
      const right = document.querySelector(".topbar-right");
      if (right) right.insertBefore(badge, right.firstChild);
    }
    if (SG.backend.isReal()) {
      badge.className = "status-pill status-ok";
      badge.innerHTML = '<span class="status-dot"></span> Real backend · ' +
                        (SG.backend.state.platform || "ok");
    } else {
      badge.className = "status-pill status-warn";
      badge.innerHTML = '<span class="status-dot"></span> Mock mode';
      badge.title = "Open via http://127.0.0.1:4173 to enable real scans";
    }
  }
})();
