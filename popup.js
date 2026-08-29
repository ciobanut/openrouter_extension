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

async function loadData() {
  show($('#loading'));
  hide($('#error'));
  hide($('#content'));

  try {
    // Fetch user info
    const userResp = await bgFetch('/private/users/current');
    const userInfo = userResp.data || userResp;

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

    // Fetch model usage for all periods
    const periods = [
      { id: '15m', minutes: 15, granularity: 'minute', label: '15 min' },
      { id: '1h', minutes: 60, granularity: 'minute', label: '1 hour' },
      { id: '3h', minutes: 180, granularity: 'minute', label: '3 hours' },
      { id: 'day', minutes: 1440, granularity: 'day', label: 'Today' },
      { id: 'week', minutes: 10080, granularity: 'day', label: 'This Week' },
      { id: 'month', minutes: 43200, granularity: 'day', label: 'This Month' }
    ];
    const periodData = {};

    await Promise.all(periods.map(async (p) => {
      try {
        const resp = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'get-model-usage', minutes: p.minutes, granularity: p.granularity },
            (resp) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else if (resp?.error) reject(new Error(resp.error));
              else resolve(resp);
            }
          );
        });
        const raw = resp.data || resp;
        const entries = Array.isArray(raw) ? raw : raw?.rows || [];
        const modelMap = new Map();
        for (const entry of entries) {
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
        const sorted = [...modelMap.values()].sort((a, b) => b.total - a.total);
        periodData[p.id] = sorted;
        const totalCost = sorted.reduce((s, e) => s + e.total, 0);
        const el = $(`#usage-${p.id}`);
        if (el) el.textContent = formatCurrency(totalCost);
      } catch (e) {
        console.error(`Failed to load ${p.id} usage:`, e);
        periodData[p.id] = [];
      }
    }));

    function renderChart(periodId) {
      const sortedUsage = periodData[periodId] || [];
      const period = periods.find(p => p.id === periodId);
      const modelList = $('#model-usage-list');
      modelList.innerHTML = '';
      $('#model-usage-count').textContent = sortedUsage.length;
      $('#chart-title').textContent = `Usage by Model (${period.label})`;

      document.querySelectorAll('.period-card').forEach(c => {
        c.classList.toggle('active', c.dataset.period === periodId);
      });

      if (sortedUsage.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'key-item';
        empty.innerHTML = `<span class="key-name" style="color:#666">No usage in ${period.label.toLowerCase()}</span>`;
        modelList.appendChild(empty);
        hide($('#model-chart-wrap'));
        return;
      }

      const labels = sortedUsage.map(e => {
        const parts = e.model.split('/');
        return parts[parts.length - 1];
      });
      const data = sortedUsage.map(e => parseFloat(e.total.toFixed(4)));
      const maxVal = Math.max(...data, 0.01);
      const chartHeight = Math.max(140, sortedUsage.length * 32 + 60);

      const chartConfig = {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Cost ($)',
            data,
            backgroundColor: '#00c49f',
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
              ticks: { fontColor: '#ccc', fontSize: 10 },
              gridLines: { display: false }
            }]
          },
          plugins: {
            datalabels: {
              display: true,
              anchor: 'end',
              align: 'right',
              backgroundColor: '#40e0d0',
              color: '#0a0a0b',
              borderRadius: 10,
              font: { size: 11, weight: '700' },
              formatter: "function(v) { return '$' + Number(v).toFixed(4); }"
            }
          }
        }
      };

      const chartUrl = 'https://quickchart.io/chart?w=320&h=' + chartHeight +
        '&bg=%23161618&c=' + encodeURIComponent(JSON.stringify(chartConfig));
      $('#model-chart').src = chartUrl;
      show($('#model-chart-wrap'));

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

    document.querySelectorAll('.period-card').forEach(card => {
      card.addEventListener('click', () => {
        const periodId = card.dataset.period;
        if (periodId && periods.find(p => p.id === periodId)) {
          renderChart(periodId);
        }
      });
    });

    renderChart('15m');

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
