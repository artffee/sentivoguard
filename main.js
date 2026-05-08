// SentivoGuard — Electron main process.
//
// Architecture:
//   1. Spawn the existing .server.js as a child process on a free port.
//   2. Wait for /api/health to respond.
//   3. Load the renderer at http://127.0.0.1:<port>/ — same-origin /api/* fetches
//      "just work" without any URL rewrites in the renderer.
//   4. Add a system tray so the watcher daemon keeps running when the window
//      is closed (closing minimises to tray, Quit from tray exits the process).

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog } = require("electron");
const path  = require("path");
const fs    = require("fs");
const http  = require("http");
const { spawn } = require("child_process");

const SG_PORT = 41730;        // dedicated port to avoid clashing with `node .server.js`
const HEALTH_TIMEOUT_MS = 15_000;

let win        = null;
let tray       = null;
let backendCh  = null;
let quitting   = false;

// ─── Single-instance lock ──────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    }
  });
}

// ─── Backend lifecycle ─────────────────────────────────────────────
function spawnBackend() {
  const serverScript = path.join(__dirname, ".server.js");
  if (!fs.existsSync(serverScript)) {
    dialog.showErrorBox("Backend missing", "Could not find " + serverScript);
    app.quit();
    return null;
  }

  const child = spawn(process.execPath, [serverScript], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      SG_PORT: String(SG_PORT),
      ELECTRON_RUN_AS_NODE: "1"   // run the backend as plain Node, not Electron
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (d) => process.stdout.write("[backend] " + d));
  child.stderr.on("data", (d) => process.stderr.write("[backend!] " + d));
  child.on("exit", (code, sig) => {
    console.log("[backend] exited code=" + code + " sig=" + sig);
    if (!quitting && code !== 0) {
      // Crashed unexpectedly — surface to user.
      dialog.showErrorBox("SentivoGuard backend stopped",
        "The background service exited unexpectedly (code " + code + "). " +
        "Try restarting the app.");
    }
  });

  return child;
}

function waitForBackend() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ hostname: "127.0.0.1", port: SG_PORT, path: "/api/health" }, (res) => {
        if (res.statusCode === 200) { res.resume(); return resolve(); }
        res.resume();
        retry();
      });
      req.on("error", retry);
      req.setTimeout(800, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error("backend health timeout"));
      setTimeout(tick, 250);
    };
    tick();
  });
}

// ─── Window + Tray ─────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1340,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0a0f0c",
    title: "SentivoGuard",
    icon: pickIcon(),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadURL("http://127.0.0.1:" + SG_PORT + "/");

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Closing the window minimises to tray on Windows; explicit Quit exits.
  win.on("close", (e) => {
    if (!quitting && process.platform === "win32") {
      e.preventDefault();
      win.hide();
      if (tray) tray.displayBalloon({
        title:   "SentivoGuard is still running",
        content: "Real-time protection stays active. Right-click the tray icon to quit."
      });
    }
  });
}

function createTray() {
  const iconPath = pickTrayIcon();
  if (!iconPath) return;

  try { tray = new Tray(iconPath); }
  catch (e) { console.warn("Could not create tray:", e.message); return; }

  tray.setToolTip("SentivoGuard · Real-time protection active");

  const menu = Menu.buildFromTemplate([
    { label: "Open SentivoGuard", click: () => { if (win) { win.show(); win.focus(); } } },
    { label: "Run Quick Scan",    click: () => { if (win) { win.show(); win.webContents.send("nav", "diskscan"); } } },
    { label: "Open Quarantine",   click: () => { if (win) { win.show(); win.webContents.send("nav", "quarantine"); } } },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on("click",        () => { if (win) { win.show(); win.focus(); } });
  tray.on("double-click", () => { if (win) { win.show(); win.focus(); } });
}

function pickIcon() {
  const candidates = [
    path.join(__dirname, "assets", "icon.ico"),
    path.join(__dirname, "assets", "icon.png")
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return undefined;
}
function pickTrayIcon() {
  // Tray icons should be small (16x16 or 32x32). Fall back to the main icon.
  return pickIcon();
}

// ─── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(async () => {
  backendCh = spawnBackend();
  if (!backendCh) return;

  try {
    await waitForBackend();
  } catch (e) {
    dialog.showErrorBox("SentivoGuard couldn't start",
      "The background service didn't respond in time.\n\n" + e.message);
    app.quit();
    return;
  }

  createWindow();
  createTray();
});

app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => {
  if (backendCh && !backendCh.killed) {
    try { backendCh.kill("SIGTERM"); } catch {}
  }
});

app.on("window-all-closed", () => {
  // On Windows the window-close handler hides instead of closing, so this
  // event only fires on actual quit. On macOS, follow the dock convention.
  if (process.platform !== "darwin" && quitting) app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC: nav requests from tray menu ──────────────────────────────
// (the renderer subscribes via preload.js and routes accordingly)
