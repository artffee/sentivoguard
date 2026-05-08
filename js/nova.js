// Nova AI — floating chat panel logic.
// Uses SG.api (Electron IPC | direct browser fetch | local mock).
// History and token usage persist across reloads via SG.store.

SG.nova = (function () {
  const panel    = () => document.getElementById("nova-panel");
  const messages = () => document.getElementById("nova-messages");
  const chips    = () => document.getElementById("nova-chips");
  const tokensEl = () => document.getElementById("nova-tokens");
  const sendBtn  = () => document.getElementById("nova-send");

  const HIST_KEY = "novaHistory";
  let history = SG.store.get(HIST_KEY, []);
  let busy = false;

  function open()  { panel().classList.remove("hidden"); document.getElementById("nova-text").focus(); }
  function close() { panel().classList.add("hidden"); }

  function reset() {
    history = [];
    SG.store.set(HIST_KEY, history);
    messages().innerHTML = "";
    chips().style.display = "";
    addBot(welcome(), { persist: false });
  }

  function welcome() {
    const mode = SG.api.getMode();
    if (mode === "electron")
      return "Hi, I'm **Nova**. I'm wired to the real Claude API via the secure Electron bridge — your key never leaves the main process. Ask me anything.";
    if (mode === "browser")
      return "Hi, I'm **Nova**. Real Claude API is connected (`" + SG.api.MODEL + "`). Ask me about scans, threats, or any of your 14 SentivoGuard tools.";
    return "Hi, I'm **Nova**. I'm running in **mock mode** — open `Settings` and paste an Anthropic API key (`sk-ant-…`) to enable real responses. The mock can still answer questions about Instinct, the VPN, and quarantine commands.";
  }

  function addUser(text) {
    chips().style.display = "none";
    history.push({ role: "user", content: text });
    SG.store.set(HIST_KEY, history);
    appendBubble("user", text);
  }

  function addBot(text, opts) {
    if (!opts || opts.persist !== false) {
      history.push({ role: "assistant", content: text });
      SG.store.set(HIST_KEY, history);
    }
    appendBubble("bot", text);
  }

  function addError(text) {
    appendBubble("system", text);
  }

  function appendBubble(kind, text) {
    const div = document.createElement("div");
    div.className = "msg " + kind;
    if (kind === "user") {
      div.textContent = text;
    } else {
      div.innerHTML = formatMarkdown(text);
    }
    messages().appendChild(div);
    messages().scrollTop = messages().scrollHeight;
  }

  function showTyping() {
    const div = document.createElement("div");
    div.className = "msg bot";
    div.id = "typing";
    div.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;
    messages().appendChild(div);
    messages().scrollTop = messages().scrollHeight;
  }
  function hideTyping() {
    const t = document.getElementById("typing");
    if (t) t.remove();
  }

  function formatMarkdown(text) {
    return text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }

  async function send(text) {
    if (!text || busy) return;
    busy = true;
    sendBtn().disabled = true;

    addUser(text);
    showTyping();

    const reply = await SG.api.ask(history);

    hideTyping();

    if (!reply.ok) {
      const detail = reply.detail ? "\n\n`" + reply.detail.slice(0, 200) + "`" : "";
      let msg;
      if (reply.error === "no_key") {
        msg = "I need an API key to talk to Claude. Open **Settings** (sidebar) and paste your `sk-ant-…` key.";
      } else if (reply.error?.startsWith("http_401")) {
        msg = "Anthropic rejected the API key (`401`). Open **Settings** and re-enter it." + detail;
      } else if (reply.error?.startsWith("http_429")) {
        msg = "Rate-limited by Anthropic (`429`). Wait a moment and retry." + detail;
      } else {
        msg = "Connection error: `" + (reply.error || "unknown") + "`." + detail;
      }
      addError(msg);
      // Don't poison history with the failed turn.
      history.pop();
      SG.store.set(HIST_KEY, history);
    } else {
      addBot(reply.text);

      // Track tokens (real or mocked, both populate usage).
      const out = reply.usage?.output_tokens || Math.round(reply.text.length / 3.4);
      const inp = reply.usage?.input_tokens  || Math.round(text.length / 3.4);
      SG.user.novaTokensUsed = (SG.user.novaTokensUsed || 0) + out + inp;
      SG.persist("user");
      if (tokensEl()) tokensEl().textContent = SG.user.novaTokensUsed.toLocaleString();
    }

    busy = false;
    sendBtn().disabled = false;
  }

  function rehydrate() {
    messages().innerHTML = "";
    if (!history.length) {
      chips().style.display = "";
      appendBubble("bot", welcome());
      return;
    }
    chips().style.display = "none";
    for (const m of history) {
      appendBubble(m.role === "user" ? "user" : "bot", m.content);
    }
  }

  function init() {
    const form = document.getElementById("nova-form");
    const text = document.getElementById("nova-text");

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = text.value.trim();
      text.value = "";
      autoResize();
      send(v);
    });

    text.addEventListener("input", autoResize);
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    chips().addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      send(btn.textContent);
    });

    document.getElementById("nova-close").addEventListener("click", close);
    document.getElementById("nova-new").addEventListener("click", reset);

    function autoResize() {
      text.style.height = "auto";
      text.style.height = Math.min(text.scrollHeight, 110) + "px";
    }

    // Restore counter
    if (tokensEl() && SG.user.novaTokensUsed) {
      tokensEl().textContent = SG.user.novaTokensUsed.toLocaleString();
    }

    rehydrate();
  }

  return { init, open, close, reset, send, rehydrate };
})();
