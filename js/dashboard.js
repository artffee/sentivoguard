// Dashboard view

SG.router.register("dashboard", function (view) {
  const el = SG.el;

  const protectedTools = SG.tools.filter(t => t.status === "ok").length;
  const warnings       = SG.tools.filter(t => t.status === "warn").length;

  // Hero
  const hero = el("section", { class: "dash-hero" },
    el("div", { class: "hero-card" },
      el("div", { class: "hero-eyebrow" }, "■■  Welcome back, Plus member"),
      el("h2", { class: "hero-title" }, "You are protected."),
      el("p", { class: "hero-desc" },
        "Real-time scanning is on, your VPN is connected to Frankfurt, and Nova AI is standing by. " +
        "All 14 tools are reporting healthy."),

      el("div", { class: "hero-stats" },
        statBlock("14", "Tools active"),
        statBlock("0", "Threats"),
        statBlock("12,847", "Trackers blocked today"),
        statBlock("187 GB", "VPN data this month")
      ),

      el("div", { class: "hero-actions" },
        el("button", {
          class: "btn btn-primary",
          onclick: () => SG.router.go("instinct")
        }, "◈ Run Full Scan"),
        el("button", {
          class: "btn btn-ghost",
          onclick: () => SG.nova.open()
        }, "★ Ask Nova")
      )
    ),

    el("div", { class: "quick-stats" },
      qsCard("◐", "VPN Connection", "Frankfurt · 23 ms"),
      qsCard("⊘", "Trackers Blocked", "12,847 today"),
      qsCard("◇", "Reclaimable", "2.4 GB cache")
    )
  );

  // Tools grid
  const grid = el("div", { class: "tools-grid" },
    ...SG.tools.map(t => toolCard(t))
  );

  // Activity (live)
  const feed = el("div", { class: "feed", id: "dash-feed" });
  renderFeed(feed);

  // Re-render whenever activity changes (or every 30s for "x m ago")
  function onActivity() {
    if (document.body.contains(feed)) renderFeed(feed);
  }
  document.addEventListener("sg:activity", onActivity);
  document.addEventListener("sg:activity-tick", onActivity);

  view.append(
    hero,
    el("div", { class: "section-head" },
      el("h3", {}, "Your Suite · 14 tools"),
      el("span", { class: "section-action", onclick: () => alert("Tool catalog") }, "View pricing →")
    ),
    grid,
    el("div", { class: "section-head" },
      el("h3", {}, "Recent activity"),
      el("span", {
        class: "section-action",
        onclick: () => {
          if (!confirm("Clear activity feed?")) return;
          SG.activity = [];
          SG.persist("activity");
          document.dispatchEvent(new CustomEvent("sg:activity"));
        }
      }, "Clear →")
    ),
    feed
  );

  function renderFeed(feed) {
    SG.activity_log.refreshTimes();
    feed.innerHTML = "";
    const items = (SG.activity || []).slice(0, 10);
    if (!items.length) {
      feed.appendChild(
        el("div", {
          class: "muted",
          style: "padding: 20px; text-align: center; font-size: 12px;"
        }, "No activity yet. Run a scan or toggle a tool.")
      );
      return;
    }
    items.forEach(a =>
      feed.appendChild(
        el("div", { class: "feed-item" },
          el("div", { class: "feed-icon " + a.type }, a.icon),
          el("div", { class: "feed-meta", html: a.msg }),
          el("div", { class: "feed-time" }, a.time)
        )
      )
    );
  }

  function statBlock(num, label) {
    return el("div", { class: "hero-stat" },
      el("div", { class: "hero-stat-num" }, num),
      el("div", { class: "hero-stat-label" }, label)
    );
  }
  function qsCard(icon, label, value) {
    return el("div", { class: "qs-card" },
      el("div", { class: "qs-card-meta" },
        el("div", { class: "qs-card-label" }, label),
        el("div", { class: "qs-card-value" }, value)
      ),
      el("div", { class: "qs-card-icon" }, icon)
    );
  }

  function toolCard(t) {
    const tagClass =
      t.tier === "Free"     ? "tag-ok" :
      t.tier === "Standard" ? "" :
      t.tier === "Plus"     ? "tag-plus" : "tag-ult";
    const statusEl =
      t.status === "ok"   ? el("span", { class: "tag tag-ok" }, "ACTIVE") :
      t.status === "warn" ? el("span", { class: "tag tag-warn" }, "ATTN")  :
                            el("span", { class: "tag" }, "OFF");

    return el("div", {
      class: "tool-card",
      onclick: () => SG.router.go(t.id)
    },
      el("div", { class: "tool-card-head" },
        el("div", { class: "tool-icon" }, t.icon),
        el("span", { class: "tag " + tagClass }, t.tier)
      ),
      el("h4", { class: "tool-name" }, t.name),
      el("div", { class: "tool-cat" }, t.cat),
      el("p", { class: "tool-desc" }, t.desc),
      el("div", { class: "tool-foot" },
        el("span", { class: "muted tiny" }, t.statusText),
        statusEl
      )
    );
  }
}, { title: "Dashboard", sub: "All systems operational · Plus plan" });
