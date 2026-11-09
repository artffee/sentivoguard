SG.router.register('vpn', view => {
  view.append(SG.el('section', { class: 'card' },
    SG.el('h2', {}, 'Shield VPN is not available'),
    SG.el('p', { class: 'muted' }, 'This release does not create a VPN tunnel, hide your IP address, or provide a kill switch. VPN connection controls will appear only when a working service is available.')
  ));
}, { title: 'Shield VPN', sub: 'Coming soon · no VPN protection provided' });
