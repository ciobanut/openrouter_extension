// OpenRouter Account Status - Background Service Worker
// Handles all API calls from the popup using the user's signed-in OpenRouter session

const FRONTEND_API = 'https://openrouter.ai/api/frontend/v1';

async function fetchFrontend(path, opts = {}) {
  const url = `${FRONTEND_API}${path}`;
  const method = opts.method || 'GET';
  const isPost = method === 'POST' || method === 'PUT' || method === 'PATCH';

  const headers = {
    'Accept': 'application/json'
  };

  if (isPost && opts.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    body: opts.body || undefined
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    let errMsg = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(errBody);
      errMsg = parsed?.error?.message || parsed?.message || errMsg;
    } catch (e) {
      // use default
    }
    const err = new Error(errMsg);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get-user') {
    fetchFrontend('/private/users/current')
      .then(data => sendResponse(data))
      .catch(e => sendResponse({ error: e.message, status: e.status }));
    return true;
  }

  if (msg.type === 'get-balance') {
    fetchFrontend('/private/stripe')
      .then(data => sendResponse(data?.data ?? data))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'fetch-balance') {
    fetch('https://openrouter.ai/settings/credits', { credentials: 'include' })
      .then(res => res.text())
      .then(html => {
        // Extract balance
        const match = html.match(/displayBalance["\\]*:\s*(-?[\d.]+)/);
        if (match) {
          sendResponse({ balance: parseFloat(match[1]) });
        } else {
          sendResponse({ balance: null });
        }
      })
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'get-activity') {
    const now = new Date();
    const start = msg.date
      ? new Date(msg.date + 'T00:00:00.000Z')
      : new Date(Date.now() - 86400000);
    const end = msg.date
      ? new Date(msg.date + 'T23:59:59.999Z')
      : now;

    const payload = {
      metrics: [
        'total_usage', 'request_count',
        'tokens_prompt', 'tokens_completion',
        'reasoning_tokens'
      ],
      dimensions: ['model'],
      granularity: 'day',
      time_range: { start: start.toISOString(), end: end.toISOString() },
      order_by: { field: 'date', direction: 'asc' },
      limit: 200
    };

    fetchFrontend('/private/analytics-query', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
      .then(data => sendResponse(data?.data ?? data))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'get-model-usage') {
    const minutes = msg.minutes || 60;
    const granularity = msg.granularity || 'minute';
    const now = new Date();
    const start = msg.start ? new Date(msg.start) : new Date(Date.now() - minutes * 60000);

    const payload = {
      metrics: ['total_usage', 'request_count', 'tokens_prompt', 'tokens_completion', 'tokens_total', 'cache_hit_rate'],
      dimensions: ['model'],
      granularity,
      time_range: { start: start.toISOString(), end: now.toISOString() },
      order_by: { field: 'date', direction: 'asc' },
      limit: 400
    };
    if (msg.timezone) payload.timezone = msg.timezone;

    fetchFrontend('/private/analytics-query', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
      .then(data => sendResponse(data?.data ?? data))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
});
