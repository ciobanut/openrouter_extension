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

  // Only add Content-Type for requests with a body
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
    throw new Error(errMsg);
  }

  return res.json();
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'api-fetch') {
    fetchFrontend(msg.path)
      .then(data => sendResponse(data))
      .catch(e => sendResponse({ error: e.message }));
    return true; // keep channel open for async
  }

  if (msg.type === 'api-post') {
    fetchFrontend(msg.path, {
      method: 'POST',
      body: JSON.stringify(msg.body)
    })
      .then(data => sendResponse(data?.data ?? data))
      .catch(e => sendResponse({ error: e.message }));
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
        // Extract balance from aria-label: "Total available credits: $X.XX"
        const match = html.match(/Total available credits:?\s*\$([\d,.]+)/);
        if (match) {
          sendResponse({ balance: parseFloat(match[1].replace(/,/g, '')) });
        } else {
          // Fallback: look for the balance in the page text
          const match2 = html.match(/aria-label="Total available credits:?\s*\$([\d,.]+)"/);
          if (match2) {
            sendResponse({ balance: parseFloat(match2[1].replace(/,/g, '')) });
          } else {
            sendResponse({ balance: null });
          }
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
    const start = new Date(Date.now() - minutes * 60000);

    const payload = {
      metrics: ['total_usage', 'request_count'],
      dimensions: ['model'],
      granularity,
      time_range: { start: start.toISOString(), end: now.toISOString() },
      order_by: { field: 'date', direction: 'desc' },
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
});
