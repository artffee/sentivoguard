// Transactional email: requires a verified sender and server-side API key.
// Missing configuration is an error; tokens and message bodies are never logged.
const RESEND_URL = "https://api.resend.com/emails";

function configured() {
  return !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM;
}

function fromAddr() {
  return process.env.RESEND_FROM;
}

async function send({ to, subject, html, text, replyTo }) {
  if (!configured()) {
    return { ok: false, error: "email_delivery_unavailable" };
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
      signal: AbortSignal.timeout(10000),
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

module.exports = { send, configured };
