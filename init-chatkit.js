// init-chatkit.js — same-origin module that initializes the openai-chatkit element.
// Hardened: waits for registration, retries create-session, explicit returns.

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 600;

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

async function fetchWithTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return resp;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function createSessionWithRetries(path = '/api/create-session') {
  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    try {
      const resp = await fetchWithTimeout(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin'
      });

      const text = await resp.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }

      if (!resp.ok) {
        const detail = json ?? text ?? `HTTP ${resp.status}`;
        const err = new Error(`session create failed (status ${resp.status}): ${String(detail)}`);
        err.status = resp.status;
        err.body = detail;
        throw err;
      }

      if (!json || !json.client_secret) {
        throw new Error(`session create returned unexpected body: ${text || '<empty>'}`);
      }

      return json;
    } catch (err) {
      const isLast = attempt >= MAX_ATTEMPTS;
      console.warn('[init-chatkit] create-session attempt', attempt, 'failed:', err?.message ?? err);
      if (isLast) throw err;
      const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
      await delay(backoff);
    }
  }
  throw new Error('createSessionWithRetries: exhausted attempts');
}

(async () => {
  try {
    // Wait for the component to register (with timeout)
    const wait = customElements.whenDefined('openai-chatkit');
    const registrationTimeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('openai-chatkit did not register in time')), 5000)
    );
    await Promise.race([wait, registrationTimeout]);

    const el = document.getElementById('chat');
    if (!el) {
      console.error('[init-chatkit] Chat element not found (#chat)');
      return; // early exit
    }

    el.setOptions({
      api: {
        async getClientSecret(existing) {
          if (existing) return existing;
          const json = await createSessionWithRetries('/api/create-session');
          if (!json || !json.client_secret) {
            throw new Error('create-session returned invalid payload');
          }
          return json.client_secret;
        }
      }
    });

    console.info('[init-chatkit] initialization complete');
    return;
  } catch (err) {
    console.error('[init-chatkit] initialization failed:', err);
    return;
  }
})();
