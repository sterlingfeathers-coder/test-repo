const form = document.getElementById('scanForm');
const button = document.getElementById('scanButton');
const overviewEl = document.getElementById('overview');
const insightsEl = document.getElementById('insights');
const linkListEl = document.getElementById('linkList');
const linkSummaryEl = document.getElementById('linkSummary');
const statusChip = document.getElementById('statusChip');
const heroTime = document.getElementById('heroTime');
const heroBroken = document.getElementById('heroBroken');
const statusPill = document.getElementById('statusPill');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = new FormData(form).get('url');
  if (!url) return;
  setLoading(true);
  clearUI();

  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      renderError(payload.error || 'Unable to scan the site.');
      return;
    }
    renderResults(payload.data);
  } catch (error) {
    renderError(error.message || 'Unable to reach the scanner.');
  } finally {
    setLoading(false);
  }
});

function setLoading(isLoading) {
  button.disabled = isLoading;
  button.textContent = isLoading ? 'Scanning...' : 'Scan now';
}

function clearUI() {
  overviewEl.innerHTML = '';
  insightsEl.innerHTML =
    '<li class="muted">Run a scan to see prioritized recommendations.</li>';
  linkListEl.innerHTML = '<p class="muted">Testing up to 8 links...</p>';
  linkSummaryEl.textContent = 'Scanning...';
  statusChip.textContent = 'Scanning...';
  heroBroken.textContent = '—';
  heroTime.textContent = '— ms';
  statusPill.textContent = 'Checking';
  statusPill.className = 'pill warn';
}

function renderResults(data) {
  heroTime.textContent = `${data.loadTimeMs} ms`;
  heroBroken.textContent = data.links.broken;
  statusPill.textContent = data.status >= 200 && data.status < 400 ? 'Healthy' : 'Review';
  statusPill.className =
    data.links.broken > 0 || data.status >= 400 ? 'pill bad' : 'pill good';

  statusChip.textContent = `${data.status} ${data.statusText}`;
  renderOverview(data);
  renderInsights(data);
  renderLinks(data.links);
}

function renderOverview(data) {
  const cards = [
    {
      label: 'Status',
      value: `${data.status} ${data.statusText}`,
      extra: data.url,
    },
    {
      label: 'Response time',
      value: `${data.loadTimeMs} ms`,
      extra: 'Measured server response',
    },
    {
      label: 'Page weight',
      value: formatBytes(data.contentLength),
      extra: 'From content-length header or response body',
    },
    {
      label: 'Links scanned',
      value: `${data.links.checked}/${data.links.total}`,
      extra: `${data.links.broken} broken`,
    },
    {
      label: 'Missing alt text',
      value: data.accessibility.missingAltImages,
      extra: 'Images without alt attributes',
    },
  ];

  overviewEl.innerHTML = cards
    .map(
      (card) => `
      <div class="card">
        <label>${card.label}</label>
        <strong>${card.value}</strong>
        <p class="muted">${card.extra}</p>
      </div>
    `,
    )
    .join('');
}

function renderInsights(data) {
  if (!data.suggestions.length) {
    insightsEl.innerHTML =
      '<li class="muted">No major issues found. Great job!</li>';
    return;
  }
  insightsEl.innerHTML = data.suggestions
    .map(
      (tip) => `
        <li class="insight">
          <span class="dot ${getDotClass(tip)}"></span>
          <div>
            <p>${tip}</p>
          </div>
        </li>
      `,
    )
    .join('');
}

function getDotClass(tip) {
  if (tip.toLowerCase().includes('broken')) return 'negative';
  if (tip.toLowerCase().includes('https') || tip.toLowerCase().includes('alt')) return 'warning';
  return 'positive';
}

function renderLinks(links) {
  linkSummaryEl.textContent = `${links.checked} checked • ${links.broken} broken of ${links.total} found`;
  if (!links.details.length) {
    linkListEl.innerHTML =
      '<p class="muted">No links were detected on the page.</p>';
    return;
  }
  linkListEl.innerHTML = links.details
    .map(
      (link) => `
      <div class="link-row">
        <div class="muted">${link.url}</div>
        <span class="status ${link.ok ? 'ok' : 'fail'}">${link.ok ? 'OK' : 'Broken'}</span>
        <span class="note">${link.status || '—'}</span>
      </div>
    `,
    )
    .join('');
}

function renderError(message) {
  insightsEl.innerHTML = `<li class="insight"><span class="dot negative"></span><div><p>${message}</p></div></li>`;
  statusChip.textContent = 'Scan failed';
  statusPill.textContent = 'Error';
  statusPill.className = 'pill bad';
  linkListEl.innerHTML = '<p class="muted">No link data.</p>';
  linkSummaryEl.textContent = 'No data';
}

function formatBytes(bytes) {
  const thresh = 1024;
  if (Math.abs(bytes) < thresh) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let u = -1;
  do {
    bytes /= thresh;
    ++u;
  } while (Math.abs(bytes) >= thresh && u < units.length - 1);
  return `${bytes.toFixed(1)} ${units[u]}`;
}
