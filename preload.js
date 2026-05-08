// Secure bridge between Electron main process and the renderer.
// The renderer can ONLY call these explicitly-exposed methods — never node, never the API key.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sentivo", {
  // True when running inside Electron (the renderer can short-circuit
  // browser-only fallbacks).
  isElectron: true,

  // Nav events from the tray menu (Run Quick Scan / Open Quarantine).
  onNav: (cb) => ipcRenderer.on("nav", (_e, route) => cb(route)),

  platform:   process.platform,
  appVersion: "2.1.0"
});
