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

/* ========================== ADDED: Teams SSO capture ========================== */
/** Holds a Teams SSO token when hosted inside the Teams webview; null otherwise. */
let teamsToken = null;

async function tryGetTeamsToken() {
  try {
    // Only attempt if the Teams SDK is available
    if (!window.microsoftTeams?.app) return null;

    await window.microsoftTeams.app.initialize();

    // This requires your Teams app manifest to include webApplicationInfo
    // (AAD App ID / resource) so SSO can issue a token.
    const t = await window.microsoftTeams.authentication.getAuthToken();
    teamsToken = t;
    return t;
  } catch {
    // non-Teams host or SSO not ready — ignore
    return null;
  }
}

// Fire-and-forget; if it resolves later, subsequent calls will use the token.
tryGetTeamsToken();
/* ======================== END ADDED: Teams SSO capture ======================== */

async function createSessionWithRetries(path = '/api/create-session') {
  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    try {
      const resp = await fetchWithTimeout(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          /* =============== ADDED: forward Teams token to your API =============== */
          ...(teamsToken ? { 'x-msteams-token': teamsToken } : {})
          /* ============= END ADDED: forward Teams token to your API ============ */
        },
        credentials: 'same-origin'
      });

      const text = await resp.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) {}

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
    // Ensure the web component is registered
    const wait = customElements.whenDefined('openai-chatkit');
    const registrationTimeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('openai-chatkit did not register in time')), 5000)
    );
    await Promise.race([wait, registrationTimeout]);

    const el = document.getElementById('chat');
    if (!el) {
      console.error('[init-chatkit] Chat element not found (#chat)');
      return;
    }

    // Robust iframe accessibility fix:
    // - Always set an accessible title
    // - If role="presentation", make it unfocusable to satisfy audits
    function fixIframes() {
      const root = el.shadowRoot;
      if (!root) return;
      root.querySelectorAll('iframe').forEach((ifr) => {
        if (!ifr.getAttribute('title')) {
          ifr.setAttribute('title', 'AI assistant conversation frame');
        }
        if (ifr.getAttribute('role') === 'presentation') {
          ifr.setAttribute('tabindex', '-1');
          ifr.setAttribute('aria-hidden', 'true');
        }
      });
    }
    const iframeObserver = new MutationObserver(fixIframes);
    iframeObserver.observe(el, { childList: true, subtree: true, attributes: true });
    fixIframes();

    // Surface server-side stream errors (useful for workflow actions)
    el.addEventListener('error', (e) => {
      console.error('[chatkit error]', e?.detail || e);
    });

    el.setOptions({
      api: {
        async getClientSecret(existing) {
          if (existing) return existing;

          // ===== PERF INSTRUMENTATION START (create-session) =====
          try {
            performance.clearMarks('ck.session.start');
            performance.clearMarks('ck.session.end');
            performance.clearMeasures('ck session ms');
          } catch {}
          performance.mark('ck.session.start');
          // ===== PERF INSTRUMENTATION END =====

          const r = await createSessionWithRetries('/api/create-session');

          // ===== PERF INSTRUMENTATION START (create-session) =====
          performance.mark('ck.session.end');
          const m = performance.measure('ck session ms', 'ck.session.start', 'ck.session.end');
          if (m && m.duration != null) {
            console.info('[perf] create-session:', Math.round(m.duration), 'ms');
          }
          // ===== PERF INSTRUMENTATION END =====

          return r.client_secret;
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
