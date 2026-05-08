// SentivoGuard — encrypted password vault.
//
// Storage shape (in localStorage via SG.store):
//   - "vaultEncrypted" — { v:1, kdf, salt, iv, ct }   (entries, encrypted)
//   - "vaultVerifier"  — { v:1, kdf, salt, iv, ct }   (encrypts a fixed string)
//
// Key derivation: PBKDF2-SHA256 200k → AES-GCM-256 (see js/crypto.js).
// The decrypted entries live ONLY in memory while the vault is unlocked.
// The "Lock" button drops them. Auto-locks after 10 minutes of view inactivity.

SG.router.register("vault", function (view) {
  const el = SG.el;

  // ── Module-level state (preserved across re-renders) ──────────────
  if (!SG._vaultMem) SG._vaultMem = {
    items:    null,          // null when locked, [] or [...] when unlocked
    selected: null,
    revealed: false,
    editing:  false,
    creating: false,
    query:    "",
    lastUseTs: 0
  };
  const M = SG._vaultMem;

  const isEncrypted = !!SG.store.get("vaultEncrypted", null);
  const isUnlocked  = M.items !== null;

  // Auto-lock after 10 minutes idle on this view.
  const AUTO_LOCK_MS = 10 * 60 * 1000;
  if (isUnlocked && M.lastUseTs && Date.now() - M.lastUseTs > AUTO_LOCK_MS) {
    lockVault(/*silent*/ true);
  }
  M.lastUseTs = Date.now();

  // ── Decision tree:
  //   1. Has encrypted vault?  -> if locked, show unlock screen
  //   2. No encrypted vault, but plain SG.vaultItems exist?  -> migration prompt
  //   3. Empty / first-run?  -> setup screen
  // ──────────────────────────────────────────────────────────────────

  if (isEncrypted && !isUnlocked) {
    return renderUnlock(view);
  }
  if (!isEncrypted) {
    return renderSetup(view);
  }
  return renderUnlocked(view);

  // ─── Setup (first-run / migration) ───────────────────────────────
  function renderSetup(view) {
    const hasLegacy = (SG.vaultItems || []).length > 0;

    view.append(
      el("div", {
        class: "card",
        style: "max-width: 540px; margin: 40px auto; text-align: center; padding: 32px;"
      },
        el("div", { style: "font-size: 42px; color: var(--accent-3); margin-bottom: 12px;" }, "▣"),
        el("h3", { style: "font-size: 22px; margin: 0 0 8px;" }, "Set a master password"),
        el("p", {
          class: "muted",
          style: "margin: 0 0 22px;",
          html: "Your vault is encrypted with <span class=\"mono\">AES-256-GCM</span> " +
                "using a key derived from this password (PBKDF2, 200k iterations). " +
                "It's never sent anywhere — losing it means losing the vault."
        }),

        passwordInput("setup-pw",     "Master password"),
        passwordInput("setup-pw2",    "Confirm password"),

        hasLegacy
          ? el("div", { class: "tag tag-warn", style: "margin: 14px 0;" },
              "Found " + SG.vaultItems.length + " existing entries — they'll be encrypted with this password.")
          : null,

        el("button", {
          class: "btn btn-primary",
          style: "margin-top: 16px; width: 100%;",
          onclick: doSetup
        }, "Encrypt & unlock vault")
      )
    );

    async function doSetup() {
      const pw  = document.getElementById("setup-pw").value;
      const pw2 = document.getElementById("setup-pw2").value;
      if (!pw || pw.length < 8) {
        alert("Master password must be at least 8 characters.");
        return;
      }
      if (pw !== pw2) {
        alert("Passwords don't match.");
        return;
      }
      const items = (SG.vaultItems || []).slice();
      try {
        const verifier = await SG.crypto.makeVerifier(pw);
        const payload  = await SG.crypto.encrypt(items, pw);
        SG.store.set("vaultVerifier",  verifier);
        SG.store.set("vaultEncrypted", payload);
        // Wipe the plaintext array so future hydrations don't expose it.
        SG.vaultItems = [];
        SG.persist("vaultItems");
        SG.activity_log.log("ok", "✓",
          "<b>SentivoVault</b> · encrypted with master password (" + items.length + " entries)");
        // Now unlock with the password we just set.
        M.items = items;
        M.lastUseTs = Date.now();
        SG.router.go("vault");
      } catch (e) {
        alert("Encryption failed: " + e.message);
      }
    }
  }

  // ─── Unlock ──────────────────────────────────────────────────────
  function renderUnlock(view) {
    view.append(
      el("div", {
        class: "card",
        style: "max-width: 540px; margin: 40px auto; text-align: center; padding: 32px;"
      },
        el("div", { style: "font-size: 42px; color: var(--accent-3); margin-bottom: 12px;" }, "🔒"),
        el("h3", { style: "font-size: 22px; margin: 0 0 8px;" }, "Vault is locked"),
        el("p", { class: "muted", style: "margin: 0 0 22px;" },
          "Enter your master password to decrypt the vault. " +
          "The decrypted entries stay in memory only and are wiped after 10 minutes of inactivity."),

        passwordInput("unlock-pw", "Master password"),

        el("div", { id: "unlock-error",
                    class: "tag tag-danger hidden",
                    style: "margin-top: 12px;" },
          "Wrong password."),

        el("button", {
          class: "btn btn-primary",
          style: "margin-top: 16px; width: 100%;",
          onclick: doUnlock
        }, "Unlock"),

        el("div", { style: "margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--bg-4);" },
          el("div", { class: "muted tiny" },
            "Forgot the password? You can wipe the encrypted vault " +
            "and start over (data lost permanently)."),
          el("button", {
            class: "btn btn-danger btn-sm",
            style: "margin-top: 6px;",
            onclick: () => {
              if (!confirm("Wipe the encrypted vault permanently? All entries will be lost.")) return;
              if (!confirm("Confirm: this is irreversible.")) return;
              SG.store.del("vaultEncrypted");
              SG.store.del("vaultVerifier");
              SG.vaultItems = [];
              SG.persist("vaultItems");
              SG.activity_log.log("danger", "X", "<b>SentivoVault</b> · wiped (forgot password)");
              SG.router.go("vault");
            }
          }, "Wipe vault & restart")
        )
      )
    );

    // Allow Enter key to submit
    setTimeout(() => {
      const inp = document.getElementById("unlock-pw");
      if (inp) {
        inp.focus();
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") doUnlock();
        });
      }
    }, 50);

    async function doUnlock() {
      const pw  = document.getElementById("unlock-pw").value;
      const err = document.getElementById("unlock-error");
      if (!pw) return;
      err.classList.add("hidden");

      const verifier = SG.store.get("vaultVerifier", null);
      if (verifier) {
        const ok = await SG.crypto.checkVerifier(verifier, pw);
        if (!ok) {
          err.classList.remove("hidden");
          err.textContent = "Wrong password.";
          return;
        }
      }
      try {
        const items = await SG.crypto.decrypt(SG.store.get("vaultEncrypted", {}), pw);
        M.items = Array.isArray(items) ? items : [];
        M.password = pw;             // held only in memory
        M.lastUseTs = Date.now();
        SG.activity_log.log("ok", "✓", "<b>SentivoVault</b> · unlocked");
        SG.router.go("vault");
      } catch (e) {
        err.classList.remove("hidden");
        err.textContent = "Decryption failed.";
      }
    }
  }

  // ─── Unlocked view (the real CRUD UI) ───────────────────────────
  function renderUnlocked(view) {
    if (!M.selected && M.items.length) M.selected = M.items[0];

    view.append(
      el("div", {
        style: "display:flex; justify-content: space-between; margin-bottom: 14px; align-items:center;"
      },
        el("div", {},
          el("div", { class: "caps muted" }, "AES-256-GCM · PBKDF2-200k · master-password unlocked"),
          el("h3", { style: "margin:4px 0 0; font-size:16px;" },
            M.items.length + " entries · encrypted at rest")
        ),
        el("div", { class: "row" },
          el("button", { class: "btn btn-ghost", onclick: startCreate }, "+ New entry"),
          el("button", { class: "btn btn-ghost", onclick: exportBackup }, "↓ Export"),
          el("button", { class: "btn btn-danger", onclick: () => lockVault(false) }, "🔒 Lock")
        )
      ),

      el("div", { class: "vault-grid" },
        buildList(),
        buildRight()
      )
    );

    // ── render helpers (same shape as before) ──
    function buildList() {
      const filtered = M.items.filter(it =>
        !M.query ||
        it.site.toLowerCase().includes(M.query) ||
        it.url.toLowerCase().includes(M.query)  ||
        it.user.toLowerCase().includes(M.query));

      const itemsEl = el("div", { class: "vault-items" });
      if (!filtered.length) {
        itemsEl.appendChild(
          el("div", {
            class: "muted",
            style: "padding: 20px; text-align: center; font-size: 12px;"
          }, M.query ? "No entries match." : "Vault is empty. Click + New entry.")
        );
      } else {
        filtered.forEach(it => {
          itemsEl.appendChild(
            el("div", {
              class: "vault-item" + (M.selected && it.id === M.selected.id ? " active" : ""),
              onclick: () => {
                M.selected = it;
                M.revealed = false;
                M.editing  = false;
                M.creating = false;
                SG.router.go("vault");
              }
            },
              el("div", { class: "vault-item-fav" }, (it.site || "?")[0]),
              el("div", {},
                el("b", {}, it.site),
                el("span", {}, it.user)
              )
            )
          );
        });
      }

      const search = document.createElement("input");
      search.placeholder = "Search " + M.items.length + " entries...";
      search.value = M.query;
      search.addEventListener("input", (e) => {
        M.query = e.target.value.trim().toLowerCase();
        const newList = buildList();
        const old = view.querySelector(".vault-list");
        old.replaceWith(newList);
        newList.querySelector(".vault-search input").focus();
      });

      return el("div", { class: "vault-list" },
        el("div", { class: "vault-search" }, search),
        itemsEl
      );
    }

    function buildRight() {
      if (M.creating || M.editing) return buildEditor();
      if (!M.selected)              return buildEmpty();
      return buildDetail();
    }

    function buildEmpty() {
      return el("div", { class: "vault-detail" },
        el("div", { style: "text-align: center; padding: 60px 20px;" },
          el("div", { style: "font-size: 36px; color: var(--accent); margin-bottom: 14px;" }, "▣"),
          el("h3", {}, "Your vault is empty"),
          el("p", { class: "muted", style: "margin: 8px 0 18px;" },
            "Add your first credential. All entries are encrypted with AES-256-GCM " +
            "before being written to localStorage."),
          el("button", { class: "btn btn-primary", onclick: startCreate }, "+ New entry")
        )
      );
    }

    function buildDetail() {
      const it = M.selected;
      const strengthColor =
        it.strength >= 80 ? "var(--ok)" :
        it.strength >= 50 ? "var(--warn)" : "var(--danger)";
      const strengthLabel =
        it.strength >= 80 ? "Strong" :
        it.strength >= 50 ? "Moderate" : "Weak — change immediately";

      return el("div", { class: "vault-detail" },
        el("div", { class: "between" },
          el("div", {},
            el("h3", {}, it.site),
            el("div", { class: "url" }, it.url)
          ),
          el("div", { class: "row" },
            el("button", { class: "btn btn-sm btn-ghost", onclick: startEdit  }, "Edit"),
            el("button", { class: "btn btn-sm btn-danger", onclick: deleteSel }, "Delete")
          )
        ),
        readField("Username", it.user, true),
        readField(
          "Password",
          M.revealed ? it.pass : maskedPassword(it.pass),
          true,
          M.revealed ? "Hide" : "Reveal",
          () => { M.revealed = !M.revealed; SG.router.go("vault"); }
        ),
        el("div", { class: "password-strength" },
          el("div", { class: "strength-bar" },
            el("div", { class: "strength-fill",
                        style: `width:${it.strength || 0}%; background:${strengthColor};` })
          ),
          el("span", { style: `color:${strengthColor}; font-weight:600;` }, strengthLabel)
        ),
        readField("URL",   it.url, true),
        readField("Notes", it.notes || "—", false),
        el("div", {
          style: "margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--bg-4);"
        },
          el("div", { class: "caps muted" }, "Audit"),
          el("div", { style: "font-size: 12.5px; margin-top: 6px;" },
            "Encrypted at rest · ID #" + it.id +
            (it.updatedAt ? " · last edited " + new Date(it.updatedAt).toLocaleString() : "")
          )
        )
      );
    }

    function buildEditor() {
      const it = M.creating ? blankEntry() : Object.assign({}, M.selected);
      return el("div", { class: "vault-detail" },
        el("h3", {}, M.creating ? "New entry" : "Edit entry"),
        el("div", { class: "url" }, M.creating ? "—" : it.url),
        formField("Site",     "site",  it.site,  "GitHub"),
        formField("URL",      "url",   it.url,   "github.com"),
        formField("Username", "user",  it.user,  "you@example.com"),
        formField("Password", "pass",  it.pass,  "•••", { mono: true }),
        formField("Notes",    "notes", it.notes || "", "Optional"),
        el("div", { style: "display:flex; gap:8px; margin-top: 18px;" },
          el("button", { class: "btn btn-primary", onclick: () => commit(it) },
            M.creating ? "Add to vault" : "Save changes"),
          el("button", { class: "btn btn-ghost",  onclick: cancelEdit }, "Cancel")
        )
      );
    }

    // ── Editor helpers ──
    function readField(label, value, copyable, action, onAction) {
      return el("div", { class: "field" },
        el("span", { class: "field-label" }, label),
        el("div", { class: "field-value" },
          el("span", { class: label === "Password" ? "password-mask" : "" }, value),
          el("div", { class: "row" },
            action   ? el("button", { class: "btn btn-sm btn-ghost", onclick: onAction }, action) : null,
            copyable ? el("button", { class: "btn btn-sm btn-ghost",
                                      onclick: () => copy(value) }, "Copy") : null
          )
        )
      );
    }

    function formField(label, name, value, placeholder, opts) {
      const input = document.createElement("input");
      input.type        = "text";
      input.value       = value || "";
      input.placeholder = placeholder || "";
      input.dataset.name = name;
      input.style.cssText =
        "width: 100%; background: var(--bg-3); border: 1px solid var(--bg-4); " +
        "color: var(--fg-0); padding: 8px 12px; border-radius: 6px; font-size: 12.5px; " +
        (opts && opts.mono ? "font-family: var(--font-mono);" : "");
      return el("div", { class: "field" },
        el("span", { class: "field-label" }, label),
        input
      );
    }

    function blankEntry() {
      const ids = M.items.map(v => v.id || 0);
      return {
        id: (ids.length ? Math.max(...ids) : 0) + 1,
        site: "", url: "", user: "", pass: "", notes: "", strength: 0
      };
    }

    function startCreate() { M.creating = true;  M.editing = false; SG.router.go("vault"); }
    function startEdit()   { if (!M.selected) return; M.editing = true; M.creating = false; SG.router.go("vault"); }
    function cancelEdit()  { M.creating = false; M.editing = false; SG.router.go("vault"); }

    async function commit(stub) {
      const inputs = view.querySelectorAll("input[data-name]");
      const next = Object.assign({}, stub);
      inputs.forEach(i => { next[i.dataset.name] = i.value.trim(); });

      if (!next.site) { alert("Please enter a site name."); return; }

      next.strength  = scorePassword(next.pass || "");
      next.updatedAt = Date.now();

      if (M.creating) {
        M.items.push(next);
        SG.activity_log.log("ok", "+",
          "<b>SentivoVault</b> · added <b>" + escapeHtml(next.site) + "</b>");
      } else {
        const idx = M.items.findIndex(v => v.id === M.selected.id);
        if (idx >= 0) M.items[idx] = next;
        SG.activity_log.log("info", "✎",
          "<b>SentivoVault</b> · updated <b>" + escapeHtml(next.site) + "</b>");
      }
      await persistEncrypted();
      M.selected = next;
      M.creating = M.editing = false;
      M.revealed = false;
      SG.router.go("vault");
    }

    async function deleteSel() {
      if (!M.selected) return;
      if (!confirm("Delete entry for " + M.selected.site + "?")) return;
      const removed = M.selected;
      M.items = M.items.filter(v => v.id !== M.selected.id);
      await persistEncrypted();
      SG.activity_log.log("warn", "−",
        "<b>SentivoVault</b> · deleted <b>" + escapeHtml(removed.site) + "</b>");
      M.selected = M.items[0] || null;
      SG.router.go("vault");
    }

    function exportBackup() {
      const blob = new Blob([JSON.stringify(M.items, null, 2)],
                            { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href = url;
      a.download = "sentivoguard-vault-" +
                   new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      URL.revokeObjectURL(url);
      SG.activity_log.log("info", "↓",
        "<b>SentivoVault</b> · exported plaintext backup (" + M.items.length + " entries)");
    }

    async function persistEncrypted() {
      // Re-encrypt the whole list with the held master password.
      // (We DON'T store the password to localStorage — it lives only in M.password.)
      const payload = await SG.crypto.encrypt(M.items, M.password);
      SG.store.set("vaultEncrypted", payload);
      M.lastUseTs = Date.now();
    }

    function maskedPassword(p) {
      return "•".repeat(Math.min((p || "").length, 16));
    }
    function copy(v) { if (navigator.clipboard) navigator.clipboard.writeText(v); }
  }

  // ─── Shared helpers ─────────────────────────────────────────────
  function passwordInput(id, placeholder) {
    const i = document.createElement("input");
    i.type = "password";
    i.id   = id;
    i.placeholder = placeholder;
    i.style.cssText =
      "width: 100%; background: var(--bg-3); border: 1px solid var(--bg-4); " +
      "color: var(--fg-0); padding: 10px 14px; border-radius: 8px; " +
      "font-size: 14px; margin-top: 8px;";
    return i;
  }

  function lockVault(silent) {
    M.items    = null;
    M.password = null;
    M.selected = null;
    M.revealed = false;
    M.editing  = false;
    M.creating = false;
    if (!silent) SG.activity_log.log("info", "🔒", "<b>SentivoVault</b> · locked");
    SG.router.go("vault");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function scorePassword(p) {
    if (!p) return 0;
    let s = 0;
    if (p.length >= 8)   s += 20;
    if (p.length >= 12)  s += 20;
    if (p.length >= 16)  s += 15;
    if (/[a-z]/.test(p)) s += 10;
    if (/[A-Z]/.test(p)) s += 10;
    if (/[0-9]/.test(p)) s += 10;
    if (/[^A-Za-z0-9]/.test(p)) s += 15;
    if (/(.)\1{2,}/.test(p))    s -= 10;
    if (/^(password|hunter|letmein|admin|qwerty)/i.test(p)) s -= 30;
    return Math.max(0, Math.min(100, s));
  }

}, { title: "SentivoVault", sub: "AES-256-GCM · PBKDF2-200k · master-password gate" });
