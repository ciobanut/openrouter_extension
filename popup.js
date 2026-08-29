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

    // Fetch hourly model usage
    try {
      const usageResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'get-hourly-model-usage' }, (resp) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (resp?.error) reject(new Error(resp.error));
          else resolve(resp);
        });
      });

      const usageData = usageResp.data || usageResp;
      const usageEntries = Array.isArray(usageData) ? usageData : usageData?.rows || [];

      // Aggregate by model: sum total_usage per model, keep latest date
      const modelMap = new Map();
      for (const entry of usageEntries) {
        const model = entry.model || entry.dimensions?.model || 'unknown';
        const cost = parseFloat(entry.total_usage || entry.metrics?.total_usage || 0);
        const date = entry.date || entry.dimensions?.date || '';
        const requests = parseInt(entry.request_count || entry.metrics?.request_count || 0, 10);

        if (modelMap.has(model)) {
          const existing = modelMap.get(model);
          existing.total += cost;
          existing.requests += requests;
          if (date > existing.latestDate) existing.latestDate = date;
        } else {
          modelMap.set(model, { model, total: cost, requests, latestDate: date });
        }
      }

      // Convert to array, sort by total descending for chart
      const sortedUsage = [...modelMap.values()]
        .sort((a, b) => b.total - a.total);

      const modelList = $('#model-usage-list');
      modelList.innerHTML = '';
      $('#model-usage-count').textContent = sortedUsage.length;

      if (sortedUsage.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'key-item';
        empty.innerHTML = `<span class="key-name" style="color:#666">No usage in the last hour</span>`;
        modelList.appendChild(empty);
      } else {
        // Build QuickChart bar chart
        const labels = sortedUsage.map(e => {
          const parts = e.model.split('/');
          return parts[parts.length - 1];
        });
        const data = sortedUsage.map(e => parseFloat(e.total.toFixed(4)));
        const dataLabels = sortedUsage.map(e => '$' + e.total.toFixed(4));
        const maxVal = Math.max(...data, 0.01);
        const chartHeight = Math.max(140, sortedUsage.length * 32 + 60);

        const chartConfig = {
          type: 'bar',
          data: {
            labels,
            datasets: [{
              label: 'Cost ($)',
              data,
              backgroundColor: 'rgba(200, 255, 0, 0.7)',
              borderColor: '#c8ff00',
              borderWidth: 1,
              borderRadius: 4
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: false,
            maintainAspectRatio: false,
            legend: { display: false },
            scales: {
              xAxes: [{
                ticks: {
                  beginAtZero: true,
                  max: maxVal * 1.3,
                  fontColor: '#888',
                  fontSize: 9
                },
                gridLines: { color: 'rgba(255,255,255,0.06)' }
              }],
              yAxes: [{
                ticks: {
                  fontColor: '#ccc',
                  fontSize: 10
                },
                gridLines: { display: false }
              }]
            },
            plugins: {
              datalabels: {
                display: true,
                anchor: 'end',
                align: 'right',
                backgroundColor: '#c8ff00',
                color: '#0a0a0b',
                // padding: [2, 8],
                borderRadius: 10,
                font: { size: 11, weight: '700' },
                formatter: "function(v, ctx) { return '$' + Number(v).toFixed(4); }"
              }
            }
          }
        };

        const chartUrl = 'https://quickchart.io/chart?w=320&h=' + chartHeight +
          '&bg=%23161618&c=' + encodeURIComponent(JSON.stringify(chartConfig));

        const chartWrap = $('#model-chart-wrap');
        const chartImg = $('#model-chart');
        chartImg.src = chartUrl;
        show(chartWrap);

        // Also show the list below the chart
        for (const entry of sortedUsage) {
          const div = document.createElement('div');
          div.className = 'key-item';
          const timeStr = entry.latestDate
            ? new Date(entry.latestDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
          const displayName = entry.model.split('/').pop() || entry.model;
          div.innerHTML = `
            <div class="model-info">
              <span class="key-name">${escapeHtml(displayName)}</span>
              <span class="model-time">${timeStr}</span>
            </div>
            <span class="key-usage ${entry.total > 0 ? 'highlight' : ''}">${formatCurrency(entry.total)}</span>
          `;
          modelList.appendChild(div);
        }
      }
    } catch (e) {
      console.error('Failed to load model usage:', e);
      const modelList = $('#model-usage-list');
      modelList.innerHTML = '';
      const errDiv = document.createElement('div');
      errDiv.className = 'key-item';
      errDiv.innerHTML = `<span class="key-name" style="color:#666">Could not load usage data</span>`;
      modelList.appendChild(errDiv);
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
