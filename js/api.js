// Nova uses the Electron bridge. Browser demos cannot send credentials.
SG.api = (() => {
  let configured = false;
  async function init() {
    // Remove the old insecure API-key copy; re-entry uses OS encrypted storage.
    SG.store.del('apiKey');
    if (window.sentivo?.novaKey) configured = !!(await window.sentivo.novaKey('status')).configured;
  }
  async function setKey(key) {
    if (!window.sentivo?.novaKey) throw new Error('Use the desktop app to configure Nova.');
    const r = await window.sentivo.novaKey('set', key);
    if (!r.ok) throw new Error(r.error);
    configured = r.configured;
  }
  async function clearKey() {
    if (window.sentivo?.novaKey) configured = !!(await window.sentivo.novaKey('clear')).configured;
  }
  async function ask(messages) {
    if (!configured || !window.sentivo?.askNova) return { ok: false, error: 'Nova is not configured. Add your own Anthropic API key in desktop Settings. Provider usage is billed separately.' };
    return window.sentivo.askNova(messages);
  }
  return { init, ask, setKey, clearKey, getKey: () => configured ? 'configured' : '', getMode: () => configured ? 'electron' : 'unavailable', MODEL: 'Claude (configured on desktop)' };
})();
