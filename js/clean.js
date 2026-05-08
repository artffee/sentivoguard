// SentivoClean — real cache enumeration + safe deletion via /api/clean.
// Falls back to mock category list when no backend.

SG.router.register("clean", function (view) {
  const el = SG.el;

  // ── render shell ──
  const realBadge = SG.backend.isReal()
    ? el("span", { class: "tag tag-ok" }, "REAL CACHE SIZES")
    : el("span", { class: "tag tag-warn" }, "MOCK MODE");

  const totalEl = el("div", { class: "clean-summary-num", id: "clean-total" }, "—");
  const summary = el("div", { class: "clean-summary" },
    el("div", {},
      el("div", { class: "caps muted", style: "display: flex; gap: 10px; align-items:center;" },
        "Reclaimable", realBadge),
      totalEl,
      el("div", { class: "muted tiny" }, "across selected categories")
    ),
    el("div", { class: "row" },
      el("button", { class: "btn btn-ghost", onclick: () => loadCategories() }, "↻ Rescan"),
      el("button", {
        class: "btn btn-primary",
        id: "clean-run",
        onclick: runClean
      }, "▶ Clean now")
    )
  );

  const grid = el("div", { class: "clean-categories", id: "clean-grid" },
    el("div", {
      class: "muted",
      style: "padding: 20px; text-align: center; font-size: 12px; grid-column: 1 / -1;"
    }, "Scanning…")
  );

  const privacy = el("div", { class: "card", style: "margin-top: 18px;" },
    el("div", { class: "between" },
      el("div", {},
        el("h4", { class: "card-title" }, "Privacy traces"),
        el("p", { class: "card-sub" },
          "Beyond cleanup — secure-wipe sensitive locations. Unrecoverable.")
      ),
      el("button", { class: "btn btn-ghost btn-sm" }, "Configure")
    ),
    el("div", { style: "display: flex; gap: 10px; margin-top: 8px; flex-wrap: wrap;" },
      pTrace("Recent file lists"),  pTrace("Search history"),
      pTrace("Run dialog history"), pTrace("USB connection logs"),
      pTrace("Clipboard history"),  pTrace("Activity timeline")
    )
  );

  view.append(summary, grid, privacy);

  // Categories the user has selected — id → boolean.
  // Persists in store so the user's choice survives reloads.
  let selected = SG.store.get("cleanSelected", null);
  let categories = [];

  loadCategories();

  // ── load ──
  async function loadCategories() {
    if (SG.backend.isReal()) {
      const r = await SG.backend.cleanScan();
      if (r.ok) {
        categories = r.categories;
        // Default selection: include any category with available bytes.
        if (!selected) {
          selected = {};
          categories.forEach(c => { selected[c.id] = !!(c.bytes || c.dynamic); });
          SG.store.set("cleanSelected", selected);
        }
        render();
        return;
      }
    }
    // Fallback to the static mock list.
    categories = SG.cleanCategories.map(c => ({
      id:        c.id,
      name:      c.name,
      bytes:     parseMB(c.bytes) * 1024 * 1024,
      display:   c.bytes,
      available: true,
      mock:      true
    }));
    if (!selected) {
      selected = {};
      SG.cleanCategories.forEach(c => { selected[c.id] = c.checked; });
      SG.store.set("cleanSelected", selected);
    }
    render();
  }

  // ── render ──
  function render() {
    grid.innerHTML = "";
    if (!categories.length) {
      grid.appendChild(el("div", {
        class: "muted",
        style: "padding: 20px; text-align: center; font-size: 12px; grid-column: 1 / -1;"
      }, "No cleanable categories detected."));
      totalEl.textContent = "0 MB";
      return;
    }
    categories.forEach(c => grid.appendChild(catCard(c)));
    recomputeTotal();
  }

  function catCard(c) {
    const isSelected = !!selected[c.id];
    const dim = !c.available && !c.dynamic;
    const card = el("div", {
      class: "clean-cat",
      style: dim ? "opacity: 0.5;" : ""
    },
      el("div", {
        class: "clean-check" + (isSelected ? " checked" : ""),
        onclick: () => toggle(c, card)
      }, isSelected ? "✓" : ""),
      el("div", { class: "clean-info" },
        el("b", {}, c.name + (c.mock ? " (mock)" : c.dynamic ? " · runs " + c.dynamic : "")),
        el("span", {}, c.display || formatBytes(c.bytes || 0))
      )
    );
    return card;
  }

  function pTrace(name) { return el("span", { class: "tag" }, name); }

  function toggle(c, card) {
    if (!c.available && !c.dynamic) return;
    selected[c.id] = !selected[c.id];
    SG.store.set("cleanSelected", selected);
    const check = card.querySelector(".clean-check");
    check.classList.toggle("checked", selected[c.id]);
    check.textContent = selected[c.id] ? "✓" : "";
    recomputeTotal();
  }

  function recomputeTotal() {
    const total = categories
      .filter(c => selected[c.id])
      .reduce((sum, c) => sum + (c.bytes || 0), 0);
    totalEl.textContent = formatBytes(total);
    return total;
  }

  // ── run ──
  async function runClean() {
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (!ids.length) { alert("Select at least one category to clean."); return; }

    const btn = document.getElementById("clean-run");
    btn.disabled = true;
    btn.textContent = "Cleaning…";

    if (SG.backend.isReal()) {
      const cats = categories.filter(c => selected[c.id]);
      const totalBytes = cats.reduce((s, c) => s + (c.bytes || 0), 0);
      const ok = confirm(
        "About to permanently delete from " + cats.length + " categories (≈ " + formatBytes(totalBytes) + ").\n\n" +
        cats.map(c => "• " + c.name + " · " + (c.display || formatBytes(c.bytes))).join("\n") +
        "\n\nAffected paths are well-known cache directories only. User documents are never touched. Continue?"
      );
      if (!ok) {
        btn.disabled = false;
        btn.textContent = "▶ Clean now";
        return;
      }
      const r = await SG.backend.cleanRun(ids);
      if (!r.ok) {
        alert("Backend error: " + (r.error || "unknown"));
      } else {
        SG.activity_log.log("ok", "✓",
          "<b>SentivoClean</b> · REAL · reclaimed <b>" + r.display + "</b> across " +
          r.perCategory.length + " categories");
        // Re-scan to show new (much smaller) sizes.
        await loadCategories();
      }
    } else {
      // Mock path: drain visually for the demo
      const reclaimed = recomputeTotal();
      for (const c of categories) {
        if (!selected[c.id]) continue;
        await new Promise(r => setTimeout(r, 200));
        c.bytes = 0;
        c.display = "0 MB";
      }
      render();
      SG.activity_log.log("ok", "✓",
        "<b>SentivoClean</b> · MOCK · simulated reclaim of <b>" + formatBytes(reclaimed) + "</b>");
    }

    btn.disabled = false;
    btn.textContent = "▶ Clean now";
  }

  // ── utils ──
  function parseMB(s) {
    if (typeof s !== "string") return 0;
    const m = s.match(/([\d.]+)\s*(MB|GB|KB)/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const u = m[2].toUpperCase();
    return u === "GB" ? n * 1024 : u === "KB" ? n / 1024 : n;
  }

  function formatBytes(b) {
    if (b == null) return "0 B";
    if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + " GB";
    if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(0) + " MB";
    if (b >= 1024)      return (b / 1024).toFixed(0) + " KB";
    return b + " B";
  }
}, { title: "SentivoClean", sub: "Real cache enumeration · safe deletion · cache-dir allowlist only" });
