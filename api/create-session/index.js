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

    if (!OPENAI_API_KEY) {
      context.log.error('Missing env var: OPENAI_API_KEY');
      context.res = { status: 500, body: { error: 'Server misconfiguration: missing OPENAI_API_KEY' } };
      return;
    }

    // Prepare request body for ChatKit. If you don't want to provide a workflow yet,
    // we will still attempt the request — but log a warning.
    const requestBody = {};
    if (WORKFLOW_ID) {
      requestBody.workflow = { id: WORKFLOW_ID };
    } else {
      context.log.warn('CHATKIT_WORKFLOW_ID not set — sending session request without workflow (if API requires workflow this may fail).');
    }

    // Call OpenAI ChatKit sessions endpoint
    const resp = await fetch('https://api.openai.com/v1/chatkit/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        // REQUIRED: ChatKit access header (fixes invalid_beta / 502)
        'OpenAI-Beta': 'chatkit_beta=v1'
      },
      body: JSON.stringify(requestBody)
    });

    // If non-OK, capture body (try JSON then text) and return 502 with details
    if (!resp.ok) {
      let details;
      try {
        details = await resp.json();
      } catch (e) {
        details = await resp.text();
      }
      context.log.error('OpenAI session create failed', resp.status, details);
      context.res = { status: 502, body: { error: 'OpenAI session creation failed', details } };
      return;
    }

    // Success: parse response and return client_secret to frontend
    const data = await resp.json();
    const clientSecret = data?.client_secret ?? data;
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: { client_secret: clientSecret }
    };
  } catch (err) {
    context.log.error('Unhandled exception in create-session', err);
    context.res = { status: 500, body: { error: 'internal error', details: (err && err.message) || err } };
  }
};
