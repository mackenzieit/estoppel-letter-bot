// api/create-session/index.js
// Azure Functions (Node 18) — issues ChatKit client_secret with required workflow + user.

const fetch = globalThis.fetch || require('node-fetch');
const crypto = require('crypto');

function createStableAnonId(req) {
  // Derive a stable, anonymous ID from request headers (sufficient for this app).
  const src =
    (req.headers['x-ms-client-principal-id'] || '') +
    (req.headers['x-ms-client-ip'] || req.headers['x-forwarded-for'] || '') +
    (req.headers['user-agent'] || '');
  return 'user-' + crypto.createHash('sha256').update(src).digest('hex').slice(0, 24);
}

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, OpenAI-Beta'
      }
    };
    return;
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const WORKFLOW_ID    = process.env.CHATKIT_WORKFLOW_ID;

    if (!OPENAI_API_KEY || !WORKFLOW_ID) {
      context.log.error('Missing env vars OPENAI_API_KEY or CHATKIT_WORKFLOW_ID');
      context.res = { status: 500, body: { error: 'Server misconfiguration' } };
      return;
    }

    const userId = createStableAnonId(req);

    const resp = await fetch('https://api.openai.com/v1/chatkit/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'chatkit_beta=v1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workflow: { id: WORKFLOW_ID },
        // ChatKit accepts a string user id; avoids schema quirks
        user: userId
      })
    });

    if (!resp.ok) {
      let details;
      try { details = await resp.json(); } catch { details = await resp.text(); }
      context.log.error('OpenAI session create failed', resp.status, details);
      context.res = { status: 502, body: { error: 'OpenAI session creation failed', details } };
      return;
    }

    const data = await resp.json();
    const clientSecret = data?.client_secret ?? data;

    context.log('OpenAI session created', { client_secret_present: !!data?.client_secret });

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: { client_secret: clientSecret, user: userId }
    };
  } catch (err) {
    context.log.error('Unhandled exception in create-session', err);
    context.res = { status: 500, body: { error: 'internal error', details: String(err?.message || err) } };
  }
};
