/* Public page views only. No script loads before an explicit choice. */
(() => {
  'use strict';
  const config = {"hosts": ["sentivoguard.com", "www.sentivoguard.com"], "paths": ["/", "/landing", "/blog", "/blog/real-time-disk-scanner", "/blog/launching-sentivoguard-21", "/blog-real-time-disk-scanner", "/blog-launching-sentivoguard-21"], "key": "sentivoguard-visitor-consent-v1", "privacy": "/privacy#visitor-statistics", "message": "Allow optional visitor counts on SentivoGuard public pages?"};
  if (window.__publicVisitorCounts || !config.hosts.includes(location.hostname)) return;
  const normalize = p => p.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const path = () => normalize(location.pathname);
  if (!config.paths.includes(path())) return;
  window.__publicVisitorCounts = true;
  const key = config.key, ttl = 180 * 86400000;
  let loaded = false, counted = false, choice = read();
  const params = new URLSearchParams(location.search);
  try { if (params.get('analytics') === 'off') sessionStorage.setItem(key + '-qa', '1'); } catch {}
  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      return saved && saved.at <= Date.now() && Date.now() - saved.at < ttl && ['accepted','rejected'].includes(saved.value) ? saved : null;
    } catch { return null; }
  }
  function blocked() {
    let qa = params.get('analytics') === 'off';
    try { qa ||= sessionStorage.getItem(key + '-qa') === '1'; } catch {}
    return qa || navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1' || !config.paths.includes(path());
  }
  function allowed() { return !blocked() && choice?.value === 'accepted' && Date.now() - choice.at < ttl; }
  function safeReferrer() {
    if (!document.referrer) return true;
    try {
      const u = new URL(document.referrer);
      // Vercel omits same-origin referrers. Skip the measurement if an external
      // referrer contains more than its origin; beforeSend cannot redact it.
      return u.host === location.host || (u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password);
    } catch { return false; }
  }
  function beforeSend(event) {
    if (!allowed() || event.type !== 'pageview' || !safeReferrer() || document.querySelector('[data-flag-values]')) return null;
    try {
      const u = new URL(event.url);
      if (u.origin !== location.origin || !config.paths.includes(normalize(u.pathname))) return null;
      return { type: 'pageview', url: 'https://' + config.hosts[0] + normalize(u.pathname) };
    } catch { return null; }
  }
  function count() {
    if (counted || !allowed() || document.visibilityState !== 'visible') return;
    counted = true;
    // Clear any stale provider identity state. Never call identify/group/events.
    window.va('reset');
    window.va('pageview', { path: path() });
  }
  function enable() {
    if (!allowed() || !safeReferrer() || document.querySelector('[data-flag-values]')) return;
    if (loaded) { count(); return; }
    loaded = true;
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    window.va('beforeSend', beforeSend);
    const script = document.createElement('script');
    script.src = '/_vercel/insights/script.js';
    script.dataset.disableAutoTrack = '1';
    script.referrerPolicy = 'no-referrer';
    script.defer = true;
    script.addEventListener('load', count);
    script.addEventListener('error', () => { status.textContent = 'Visitor statistics could not load. The website still works.'; });
    document.head.append(script);
  }
  const panel = document.createElement('section');
  panel.className = 'visitor-consent'; panel.setAttribute('aria-label', 'Optional visitor statistics');
  const status = document.createElement('p');
  status.textContent = config.message + ' Vercel measures public page views without analytics cookies. No form text, account data or private activity is included. You can change your choice here at any time.';
  panel.append(status);
  function button(label, action, parent) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.addEventListener('click', action); parent.append(b); return b;
  }
  function choose(value) {
    choice = { value, at: Date.now() };
    try { localStorage.setItem(key, JSON.stringify(choice)); } catch { /* choice lasts this page only */ }
    panel.hidden = true; if (value === 'accepted') enable(); preferences.focus({preventScroll:true});
  }
  const reject = button('No thanks', () => choose('rejected'), panel);
  const accept = button(config.accept || 'Allow visitor statistics', () => choose('accepted'), panel);
  const privacy = document.createElement('a'); privacy.href = config.privacy; privacy.textContent = 'Privacy details'; panel.append(privacy);
  const preferences = button('Visitor statistics settings', () => { panel.hidden = false; reject.focus(); }, document.body);
  preferences.className = 'visitor-preferences';
  document.body.append(panel);
  function render() {
    accept.disabled = blocked();
    if (blocked()) { panel.hidden = true; preferences.hidden = true; }
    else { preferences.hidden = false; panel.hidden = !!choice; }
  }
  window.addEventListener('storage', e => { if (e.key === key || e.key === null) { choice = read(); render(); enable(); } });
  document.addEventListener('visibilitychange', () => { if (allowed()) { enable(); count(); } });
  render(); enable();
})();
