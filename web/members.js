const $ = id => document.getElementById(id);
const messages = { billing_unavailable: 'Checkout is not available yet. No payment has been taken.', verify_email_first: 'Verify your email before purchasing.', email_delivery_unavailable: 'Email delivery is not available yet.', service_unavailable: 'The service is temporarily unavailable. Please try again.', sign_in_required: 'Please sign in first.', too_many_attempts: 'Please wait a few minutes before trying again.', billing_already_active: 'Use Manage subscription to change your existing plan.' };
async function request(path, body) {
  const r = await fetch(path, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body || {}) });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(messages[data.error] || 'The request could not be completed. Please try again.');
  return data;
}
function action(id, fn) {
  $(id).addEventListener('click', async () => {
    const button = $(id); button.disabled = true;
    try { await fn(); } catch (e) { $('notice').textContent = e.message; }
    finally { button.disabled = false; }
  });
}
async function refresh() {
  const response = await fetch('/api/auth/me');
  const me = await response.json();
  if (!response.ok || !me.ok) throw new Error('Account service unavailable. Please try again.');
  $('notice').textContent = '';
  $('guest').hidden = me.authenticated;
  $('member').hidden = !me.authenticated;
  if (!me.authenticated) return me;
  $('identity').textContent = me.user.email;
  $('plan').textContent = me.license.tier.name;
  $('verification').textContent = me.user.emailVerified ? 'Email verified.' : 'Verify your email before starting a subscription.';
  $('verify').hidden = me.user.emailVerified;
  $('verify').disabled = !me.emailAvailable;
  $('download').hidden = !me.downloadAvailable;
  $('license').disabled = !me.licenseAvailable;
  $('portal').hidden = !me.billing.customer || !me.billing.portalAvailable;
  $('buy').disabled = !me.billing.available || !me.user.emailVerified || me.license.plan !== 'free';
  $('buy').textContent = me.billing.available ? 'Subscribe with Stripe · $49/year' : 'Checkout unavailable';
  $('checkout-status').textContent = me.billing.available ? 'Secure Stripe checkout. Manage renewal and cancellation from your account.' : 'Subscriptions open after payment and license setup is complete.';
  $('billing-state').textContent = me.billing.suspended ? 'Paid access requires a billing review. Contact support.' : me.license.expires ? 'Paid through ' + new Date(me.license.expires * 1000).toLocaleDateString() : 'Free beta access.';
  return me;
}
action('verify', async () => { await request('/api/auth/action', { purpose:'verify' }); $('notice').textContent = 'Verification email sent. Open the link, then refresh this page.'; });
action('license', async () => { const r = await request('/api/license/key'); $('license-key').hidden = false; $('license-key').value = r.token; });
action('buy', async () => { const r = await request('/api/checkout', {plan:'plus'}); location.assign(r.url); });
action('portal', async () => { const r = await request('/api/billing/portal'); location.assign(r.url); });
action('logout', async () => { await request('/api/auth/logout'); location.assign('/login'); });
(async () => {
  try {
    await refresh();
    if (new URLSearchParams(location.search).get('checkout') === 'processing') {
      for (let i=0; i<12; i++) {
        const me = await refresh();
        if (me.license?.plan !== 'free' && me.license) { $('notice').textContent = 'Payment confirmed. Your plan is active.'; return; }
        $('notice').textContent = 'Waiting for payment confirmation. You can safely return to this page later.';
        await new Promise(r => setTimeout(r, 2500));
      }
    }
  } catch(e) { $('notice').textContent = e.message; }
})();
