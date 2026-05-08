// SentivoGuard — Resend transactional email wrapper.
//
// Setup:
//   1. Sign up at resend.com (free tier: 3,000/mo, 100/day)
//   2. Get an API key from the dashboard
//   3. vercel env add RESEND_API_KEY production
//   4. (Optional) Verify a domain and set RESEND_FROM env var, e.g.
//        RESEND_FROM = "SentivoGuard <hello@sentivoguard.com>"
//      Without verification, Resend's testing address `onboarding@resend.dev`
//      works but lands in spam more often.
//
// Graceful fallback: when RESEND_API_KEY is missing, send() logs the email
// to the function output and returns { ok: true, mocked: true } so callers
// don't need to special-case the dev environment.

const RESEND_URL = "https://api.resend.com/emails";

function configured() {
  return !!process.env.RESEND_API_KEY;
}

function fromAddr() {
  return process.env.RESEND_FROM || "SentivoGuard <onboarding@resend.dev>";
}

async function send({ to, subject, html, text, replyTo }) {
  if (!configured()) {
    console.log(`[email/mock] to=${to} subject="${subject}"`);
    return { ok: true, mocked: true };
  }

  const body = {
    from:    fromAddr(),
    to:      Array.isArray(to) ? to : [to],
    subject,
    html,
    text
  };
  if (replyTo) body.reply_to = replyTo;

  let resp;
  try {
    resp = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    return { ok: false, error: "network", detail: e.message };
  }

  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return {
      ok:    false,
      error: j.message || ("http_" + resp.status),
      name:  j.name,
      statusCode: resp.status
    };
  }
  return { ok: true, id: j.id };
}

// ──────────────────────────────────────────────────────────────────
// Templates
// ──────────────────────────────────────────────────────────────────

function welcomeEmail(email) {
  const subject = "Welcome to SentivoGuard";

  const text =
`Welcome to SentivoGuard.

Your free account is active and includes:
  · Disk Scan & Quarantine — antivirus-style scanning, 16k files in ~8s
  · Real-time monitoring   — fs.watch on Downloads / Temp / AppData
  · Basic SentivoClean     — safe cache enumeration

Sign in:  https://sentivoguard.com/login
Members:  https://sentivoguard.com/members
Download: https://sentivoguard.com/members/download

Want the full suite? Upgrade to Plus ($49/yr) for AES-256 vault, Nova AI, and 5 devices.

— SentivoGuard`;

  const html = baseLayout(
    "Welcome to SentivoGuard",
    `<p>Your free account is active. Here's what you can do right now:</p>
     <ul style="padding-left: 22px; margin: 14px 0 22px;">
       <li><strong>Disk Scan</strong> — antivirus-style streaming scan, ~16k files in 8s</li>
       <li><strong>Quarantine</strong> — reversible move-to-safe-storage, SHA-256 verified</li>
       <li><strong>Real-time monitor</strong> — fs.watch on Downloads / Temp / AppData</li>
     </ul>
     <p style="margin: 28px 0;">
       <a href="https://sentivoguard.com/members/download"
          style="background: #2d6a4f; color: white; padding: 12px 22px; text-decoration: none;
                 border-radius: 8px; font-weight: 600; display: inline-block;">
         Download the Windows installer
       </a>
     </p>
     <p style="font-size: 14px; color: #4a5568;">
       Want the full suite?
       <a href="https://sentivoguard.com/members" style="color: #2d6a4f;">Upgrade to Plus</a>
       for the AES-256 vault, Nova AI assistant, and 5 devices.
     </p>`
  );

  return { subject, text, html };
}

function licenseEmail(email, plan, token) {
  const planName = capitalize(plan);
  const subject  = `Your SentivoGuard ${planName} license`;

  const text =
`Your ${planName} license is ready.

Paste this key into Settings → License key in the desktop app:

${token}

Activate online: https://sentivoguard.com/members
Download:        https://sentivoguard.com/members/download

Keep this email — your license key is your proof of purchase.

— SentivoGuard`;

  const html = baseLayout(
    `Your ${planName} license is ready`,
    `<p>Paste this key into <strong>Settings → License key</strong> in the desktop app
        — or click "Activate online" below to attach it to your members account:</p>
     <pre style="background: #f7fafc; padding: 14px 16px; border-radius: 8px;
                 font-family: 'JetBrains Mono', Consolas, monospace; font-size: 11px;
                 word-break: break-all; white-space: pre-wrap; border: 1px solid #e2e8f0;
                 color: #1a202c; line-height: 1.5;">${escapeHtml(token)}</pre>
     <p style="margin: 28px 0;">
       <a href="https://sentivoguard.com/members"
          style="background: #2d6a4f; color: white; padding: 12px 22px; text-decoration: none;
                 border-radius: 8px; font-weight: 600; display: inline-block;">
         Activate online
       </a>
     </p>
     <p style="font-size: 13px; color: #4a5568;">
       Keep this email — your license key is your proof of purchase. Lose it and we can
       re-issue from your account, but only with the same email.
     </p>`
  );

  return { subject, text, html };
}

// ──────────────────────────────────────────────────────────────────
// Layout helpers
// ──────────────────────────────────────────────────────────────────

function baseLayout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>${escapeHtml(title)}</title></head>
<body style="margin: 0; padding: 32px 16px; background: #f7fafc; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; background: white; padding: 32px;
              border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); color: #2d3748;
              line-height: 1.6;">
    <div style="display: inline-flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span style="display: inline-block; width: 12px; height: 12px; background: #74c69d; border-radius: 2px;"></span><span style="display: inline-block; width: 12px; height: 12px; background: #2d6a4f; border-radius: 2px;"></span>
      <strong style="font-size: 14px; color: #1a202c;">SentivoGuard</strong>
    </div>
    <h1 style="font-size: 22px; color: #1a202c; margin: 12px 0 16px; font-weight: 700; letter-spacing: -0.01em;">${escapeHtml(title)}</h1>
    ${bodyHtml}
    <hr style="margin: 32px 0; border: 0; border-top: 1px solid #e2e8f0;" />
    <p style="font-size: 12px; color: #718096; margin: 0;">
      SentivoGuard · Complete privacy &amp; security suite<br />
      Reply to this email if you need help.
    </p>
  </div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

module.exports = { send, welcomeEmail, licenseEmail, configured };
