// OpenRouter Account Status - Popup Script
// All API calls go through background.js service worker

const $ = (sel) => document.querySelector(sel);
const show = (el) => el.style.display = '';
const hide = (el) => el.style.display = 'none';

function formatCurrency(val) {
  if (val == null || isNaN(val)) return '$0.00';
  return '$' + Number(val).toFixed(2);
}

function formatCurrencyShort(val) {
  if (val == null || isNaN(val)) return '$0';
  const n = Number(val);
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
  if (n >= 1) return '$' + n.toFixed(2);
  if (n > 0) return '$' + n.toFixed(3);
  return '$0';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Send message to background service worker
function bgFetch(path) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'api-fetch', path }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

function bgPost(path, body) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'api-post', path, body }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

async function loadData() {
  show($('#loading'));
  hide($('#error'));
  hide($('#content'));

  try {
    // Fetch user info and workspace in parallel
    const [userResp, workspacesResp] = await Promise.all([
      bgFetch('/private/users/current'),
      bgFetch('/private/user/workspaces?scope=member')
    ]);

    // API responses wrap data: { data: { ... } }
    const userInfo = userResp.data || userResp;
    const workspaces = workspacesResp.data || workspacesResp;

    // Get active workspace - active_workspace_id is at the top level of the response
    const workspaceId = workspacesResp.active_workspace_id || workspacesResp.default_workspace_id || workspaces[0]?.id;
    const workspace = Array.isArray(workspaces) ? workspaces[0] : workspaces.data?.[0];

    // Fetch API keys
    const keysResp = await bgFetch(
      `/private/workspace-api-keys?workspace_id=${workspaceId}&limit=50&offset=0`
    );
    const keysData = keysResp.data || keysResp;

    hide($('#loading'));
    show($('#content'));

    // Populate user info
    if (userInfo.image_url) {
      $('#avatar').src = userInfo.image_url;
    }
    $('#user-name').textContent =
      [userInfo.first_name, userInfo.last_name].filter(Boolean).join(' ') ||
      userInfo.email || 'OpenRouter User';
    $('#user-email').textContent = userInfo.email || '';

    // Balance - scrape from credits page HTML
    $('#balance').textContent = '...';
    try {
      const balanceResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'fetch-balance' }, (resp) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (resp?.error) reject(new Error(resp.error));
          else resolve(resp);
        });
      });
      if (balanceResp?.balance) {
        $('#balance').textContent = formatCurrency(balanceResp.balance);
      }
    } catch (e) {
      $('#balance').textContent = 'N/A';
    }

    // Populate workspace
    $('#workspace-name').textContent = workspace?.name || 'Default Workspace';

    // Populate API keys
    const keys = keysData.keys || [];
    $('#keys-count').textContent = keys.length;

    const keysList = $('#keys-list');
    keysList.innerHTML = '';

    // Sort by total usage descending
    const sorted = [...keys]
      .filter(k => !k.deleted)
      .sort((a, b) => (b.usage || 0) - (a.usage || 0));

    // Calculate totals
    let totalDaily = 0, totalWeekly = 0, totalMonthly = 0;
    for (const k of keys) {
      totalDaily += k.usage_daily || 0;
      totalWeekly += k.usage_weekly || 0;
      totalMonthly += k.usage_monthly || 0;
    }

    $('#usage-daily').textContent = formatCurrencyShort(totalDaily);
    $('#usage-weekly').textContent = formatCurrencyShort(totalWeekly);
    $('#usage-monthly').textContent = formatCurrencyShort(totalMonthly);

    // Show top 10 keys
    for (const key of sorted.slice(0, 10)) {
      const div = document.createElement('div');
      div.className = 'key-item';
      div.innerHTML = `
        <span class="key-name">${escapeHtml(key.name || key.label)}</span>
        <span class="key-usage ${key.usage > 0 ? 'highlight' : ''}">${formatCurrencyShort(key.usage)}</span>
      `;
      keysList.appendChild(div);
    }

    if (sorted.length > 10) {
      const more = document.createElement('div');
      more.className = 'key-item';
      more.innerHTML = `<span class="key-name" style="color:#666">+${sorted.length - 10} more keys...</span>`;
      keysList.appendChild(more);
    }

  } catch (err) {
    console.error('Failed to load OpenRouter data:', err);
    hide($('#loading'));
    show($('#error'));
    const msg = err.message || 'Unknown error';
    if (msg.includes('401') || msg.includes('403')) {
      $('#error-message').textContent = 'Not logged in to OpenRouter. Please log in first.';
    } else {
      $('#error-message').textContent = `Failed to load: ${msg}`;
    }
  }
}

// Auto-load on popup open
document.addEventListener('DOMContentLoaded', loadData);
