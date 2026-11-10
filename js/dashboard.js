SG.router.register('dashboard', async view => {
  const el = SG.el;
  const scan = SG.store.get('lastScan', null);
  const status = el('p', { class: 'muted' }, 'Checking local monitoring…');
  const online = SG.backend.isReal();
  view.append(el('section', { class: 'card' },
    el('h2', {}, 'Your PC security overview'),
    el('p', { class: 'muted' }, 'Review suspicious files and Windows security settings. A scan result is limited to the checks performed and does not guarantee that a device is safe.'),
    status,
    el('div', { class: 'hero-actions' },
      el('button', { class: 'btn btn-primary', onclick: () => SG.router.go('diskscan') }, 'Scan my PC'),
      el('button', { class: 'btn btn-ghost', onclick: () => SG.router.go('quarantine') }, 'Review quarantine'),
      el('button', { class: 'btn btn-ghost', onclick: () => SG.router.go('settings') }, 'Settings & license')),
    el('p', {}, scan ? 'Last scan: ' + new Date(scan.at).toLocaleString() + ' · ' + scan.verdict + ' · ' + scan.files + ' files · ' + scan.findings + ' findings' : 'No completed scan recorded on this device.')));
  const actions = [
    ['instinct', 'Inspect a package or repository', 'Pattern-based checks for scripts, packages, images and extensions.'],
    ['defend', 'Windows Defender status', 'Read the current Windows antivirus configuration.'],
    ['watch', 'Network connections', 'Inspect current per-process connections on Windows.'],
    ['clean', 'Review cache storage', 'Measure cache sizes before choosing what to delete.'],
    ['vault', 'Encrypted local vault', 'Master-password protected storage on this device.'],
    ['nova', 'Ask Nova', 'Explain evidence you provide. Your own API key is required.']
  ];
  view.append(el('div', { class: 'tools-grid', style: 'margin-top:20px' }, ...actions.map(([route,title,description]) =>
    el('button', { class: 'tool-card', onclick: () => SG.router.go(route) }, el('h3', {}, title), el('p', {}, description)))));
  view.append(el('p', { class: 'muted' }, 'VPN, messaging, file transfer and hotspot sharing are in development. Windows status tools currently inspect settings; they do not change firewall or DNS rules.'));
  if (!online) { status.textContent = 'Local service unavailable. Restart the desktop app to run scans.'; return; }
  try {
    const r = await fetch('/api/realtime/status').then(r => r.json());
    status.textContent = r.ok ? (r.running ? 'File monitoring is running for ' + r.paths.length + ' selected folders.' : 'File monitoring is off.') : 'Monitoring status unavailable.';
  } catch { status.textContent = 'Monitoring status unavailable.'; }
}, { title: 'Dashboard', sub: 'Measured status · review findings before taking action' });
