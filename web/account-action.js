const values = new URLSearchParams(location.hash.slice(1));
const token = values.get('token');
const purpose = token && values.get('purpose') === 'verify' ? 'verify' : 'reset';
history.replaceState(null, '', location.pathname);
const form = document.getElementById('action');
if (token) {
  document.getElementById('email-label').hidden = true;
  document.getElementById('password-label').hidden = purpose !== 'reset';
  form.elements.password.required = purpose === 'reset';
  document.getElementById('title').textContent = purpose === 'verify' ? 'Verify your email' : 'Set a new password';
  document.getElementById('submit').textContent = purpose === 'verify' ? 'Verify email' : 'Save password';
} else form.elements.email.required = true;
form.addEventListener('submit', async e => {
  e.preventDefault();
  const button = document.getElementById('submit'); button.disabled = true;
  try {
    const r = await fetch('/api/auth/action', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...Object.fromEntries(new FormData(form)),token,purpose})});
    const j = await r.json();
    document.getElementById('notice').textContent = j.ok ? token ? 'Done. Return to sign in or refresh your account page.' : 'If the account exists, a reset link has been sent.' : j.error === 'email_delivery_unavailable' ? 'Email delivery is not available yet.' : 'The link may have expired or the service is unavailable. Request a new link and try again.';
    if (j.ok && token) form.hidden = true;
  } catch { document.getElementById('notice').textContent = 'Connection failed. Please try again.'; }
  finally { button.disabled = false; }
});
