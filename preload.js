// Secure bridge between Electron main process and the renderer.
// The renderer can ONLY call these explicitly-exposed methods — never node, never the API key.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sentivo", {
  // True when running inside Electron (the renderer can short-circuit
  // browser-only fallbacks).
  isElectron: true,
  askNova: messages => ipcRenderer.invoke('nova-ask', messages),
  novaKey: (operation, value) => ipcRenderer.invoke('nova-key', operation, value),

  // Nav events from the tray menu (Run Quick Scan / Open Quarantine).
  onNav: (cb) => ipcRenderer.on("nav", (_e, route) => cb(route)),

  platform:   process.platform,
  appVersion: process.argv.find(arg => arg.startsWith('--sg-app-version='))?.slice('--sg-app-version='.length) || 'unknown'
});
