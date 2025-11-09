// init-chatkit.js — placed at repo root and served from same origin.
// This file initializes the openai-chatkit element by requesting a client_secret
// from your server endpoint (/api/create-session).

(async () => {
  // Wait for the ChatKit web component to register
  await customElements.whenDefined('openai-chatkit');

  const el = document.getElementById('chat');
  if (!el) {
    console.error('Chat element not found (#chat)');
    return;
  }

  el.setOptions({
    api: {
      async getClientSecret(existing) {
        if (existing) return existing;
        const r = await fetch('/api/create-session', { method: 'POST' });
        if (!r.ok) {
          const text = await r.text();
          throw new Error('session create failed: ' + r.status + ' ' + text);
        }
        const body = await r.json();
        return body.client_secret;
      }
    }
  });
})();
