const form = document.getElementById('auth');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const notice = document.getElementById('notice');
  if (data.password2 && data.password !== data.password2) { notice.textContent = 'Passwords do not match.'; return; }
  form.querySelector('button').disabled = true;
  try {
    const response = await fetch('/api/auth/' + form.dataset.action, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(data) });
    const result = await response.json();
    if (result.ok) { location.assign('/members'); return; }
    notice.textContent = ({invalid_credentials:'Check your email and password.', user_exists:'An account already exists. Sign in or reset your password.', too_many_attempts:'Too many attempts. Please wait 15 minutes.'})[result.error] || 'The account service is unavailable. Please try again.';
  } catch { notice.textContent = 'Connection failed. Please try again.'; }
  finally { form.querySelector('button').disabled = false; }
});
