// api/create-session/index.js
// Azure Functions (Node 18) — issues ChatKit client_secret with required workflow + user.
// Adds optional: STARTER_MESSAGE (seed first assistant message) and CHAT_TITLE (force title).

const fetch = globalThis.fetch || require('node-fetch');
const crypto = require('crypto');

function createStableAnonId(req) {
  const src =
    (req.headers['x-ms-client-principal-id'] || '') +
    (req.headers['x-ms-client-ip'] || req.headers['x-forwarded-for'] || '') +
    (req.headers['user-agent'] || '');
  return 'user-' + crypto.createHash('sha256').update(src).digest('hex').slice(0, 24);
}

// tiny helper so best-effort calls don't hang
async function fetchWithTimeout(url, opts, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
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

    // 1) Create session
    const resp = await fetch('https://api.openai.com/v1/chatkit/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'chatkit_beta=v1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workflow: { id: WORKFLOW_ID },
        // String user id is accepted and avoids schema quirks
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

    // 2) Best-effort post-create actions (non-blocking, fail-soft)
    const STARTER_MESSAGE = process.env.STARTER_MESSAGE; // e.g., "Welcome! Pick an option to begin."
    const CHAT_TITLE      = process.env.CHAT_TITLE;      // e.g., "Estoppel Assistant"

    const afterCreates = [];

    if (STARTER_MESSAGE) {
      afterCreates.push(
        (async () => {
          try {
            const r = await fetchWithTimeout('https://api.openai.com/v1/chatkit/conversation', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${clientSecret}`, // NOTE: client secret
                'OpenAI-Beta': 'chatkit_beta=v1',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                messages: [{ role: 'assistant', content: STARTER_MESSAGE }]
              })
            });
            // ignore body; just ensure socket closes
            try { await r.text(); } catch {}
            if (!r.ok) context.log.warn('Seeding opener returned non-200', r.status);
          } catch (e) {
            context.log.warn('Seeding opener failed (ignored):', e?.message || e);
          }
        })()
      );
    }

    if (CHAT_TITLE) {
      afterCreates.push(
        (async () => {
          try {
            const r = await fetchWithTimeout('https://api.openai.com/v1/chatkit/conversation', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${clientSecret}`,
                'OpenAI-Beta': 'chatkit_beta=v1',
                'Content-Type': 'application/json'
              },
              // Some tenants support title/metadata; harmless no-op if ignored
              body: JSON.stringify({ title: CHAT_TITLE })
            });
            try { await r.text(); } catch {}
            if (!r.ok) context.log.warn('Set title returned non-200 (likely unsupported):', r.status);
          } catch (e) {
            context.log.warn('Set title failed/unsupported (ignored):', e?.message || e);
          }
        })()
      );
    }

    // Fire-and-forget; do not block the response
    Promise.allSettled(afterCreates).catch(() => { /* never throw to caller */ });

    // 3) Return to client
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
