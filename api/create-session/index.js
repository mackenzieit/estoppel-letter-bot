// api/create-session/index.js
const fetch = globalThis.fetch || require('node-fetch');

// simple UUIDv4 generator (no dependency)
function makeUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }};
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
    
    const resp = await fetch('https://api.openai.com/v1/chatkit/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'chatkit_beta=v1'
      },
      body: JSON.stringify({
        workflow: { id: WORKFLOW_ID },
        user: { id: createStableAnonId(req), name: 'Web User' }
      })
    });


    if (!resp.ok) {
      let details;
      try { details = await resp.json(); } catch (e) { details = await resp.text(); }
      context.log.error('OpenAI session create failed', resp.status, details);
      context.res = { status: 502, body: { error: 'OpenAI session creation failed', details } };
      return;
    }

    const data = await resp.json();
    const clientSecret = data?.client_secret ?? data;
    context.log('OpenAI session created', { client_secret_present: !!data?.client_secret });

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: { client_secret: clientSecret, user: clientUser }
    };
  } catch (err) {
    context.log.error('Unhandled exception in create-session', err);
    context.res = { status: 500, body: { error: 'internal error', details: (err && err.message) || err } };
  }
};
