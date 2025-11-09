// Azure Functions JavaScript handler (simple REST call to OpenAI ChatKit sessions)
// This file will live at: api/create-session/index.js

const fetch = globalThis.fetch || require('node-fetch');

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
    const WORKFLOW_ID = process.env.CHATKIT_WORKFLOW_ID;

    if (!OPENAI_API_KEY || !WORKFLOW_ID) {
      context.log.error('Missing env vars');
      context.res = { status: 500, body: { error: 'Server misconfiguration' } };
      return;
    }

    const resp = await fetch('https://api.openai.com/v1/chatkit/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ workflow: { id: WORKFLOW_ID } })
    });

    if (!resp.ok) {
      const text = await resp.text();
      context.log.error('OpenAI session create failed', resp.status, text);
      context.res = { status: 502, body: { error: 'OpenAI session creation failed', details: text } };
      return;
    }

    const data = await resp.json();
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: { client_secret: data.client_secret }
    };
  } catch (err) {
    context.log.error('Unhandled', err);
    context.res = { status: 500, body: { error: 'internal error' } };
  }
};
