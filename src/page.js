import { siteSeries, summarizeSeries } from './history.js';

const PALETTE = ['#1f4d3a', '#9a3412', '#1e3a5f', '#6b4c2a', '#3f6212', '#7c2d12'];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  }[char]));
}

function utcParts(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    day: get('day'),
    month: get('month'),
    year: get('year'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function formatAxis(iso) {
  const parts = utcParts(iso);
  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatStamp(iso) {
  const parts = utcParts(iso);
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} UTC`;
}

function formatPercent(ratio) {
  if (ratio == null) {
    return '—';
  }
  const percent = ratio * 100;
  const text = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
  return `${text}%`;
}

function formatLatency(value) {
  return typeof value === 'number' ? `${value} ms` : '—';
}

function statusCell(last) {
  if (!last) {
    return '<span class="text-[#3c5158]">No data</span>';
  }
  if (last.ok) {
    return '<span class="status-up inline-flex items-center gap-2 text-[#0d6846]"><span class="dot" aria-hidden="true"></span>Up</span>';
  }
  const detail = last.error
    ? `<span class="mt-1 block text-sm text-[#7a241e]">${escapeHtml(last.error)}</span>`
    : '';
  return `<span class="inline-flex items-center gap-2 text-[#7a241e]"><span class="dot" aria-hidden="true"></span>Down</span>${detail}`;
}

function buildChart(config, history) {
  return {
    labels: history.runs.map((run) => formatAxis(run.checkedAt)),
    datasets: config.sites.map((site, index) => {
      const byTime = new Map(siteSeries(history, site.slug).map((point) => [point.checkedAt, point.latencyMs]));
      return {
        label: site.name,
        color: PALETTE[index % PALETTE.length],
        data: history.runs.map((run) => {
          if (!byTime.has(run.checkedAt)) {
            return null;
          }
          const latency = byTime.get(run.checkedAt);
          return typeof latency === 'number' ? latency : null;
        }),
      };
    }),
  };
}

function renderRow(site, summary) {
  const last = summary.last;
  const down = last && !last.ok;
  return `
        <tr class="${down ? 'bg-[#f6e0dc]' : ''}">
          <td data-label="Site" class="border-b border-[#c3d2d8] px-3 py-4 align-top">
            <span class="block font-medium">${escapeHtml(site.name)}</span>
            <a class="mt-1 block break-all text-sm text-[#3c5158] underline decoration-[#9eb4bc] underline-offset-4 hover:decoration-[#132228]" href="${escapeHtml(site.url)}">${escapeHtml(site.url)}</a>
          </td>
          <td data-label="Status" class="border-b border-[#c3d2d8] px-3 py-4 align-top">${statusCell(last)}</td>
          <td data-label="Code" class="border-b border-[#c3d2d8] px-3 py-4 align-top font-mono tabular-nums">${last?.status ?? '—'}</td>
          <td data-label="Latency" class="border-b border-[#c3d2d8] px-3 py-4 align-top font-mono tabular-nums">${formatLatency(last?.latencyMs)}</td>
          <td data-label="Uptime" class="border-b border-[#c3d2d8] px-3 py-4 align-top font-mono tabular-nums">${formatPercent(summary.uptime)}</td>
        </tr>`;
}

function summaryCopy(config, history, rows) {
  if (history.runs.length === 0) {
    const noun = config.sites.length === 1 ? 'site' : 'sites';
    return `${config.sites.length} ${noun} configured. No checks have been recorded yet.`;
  }

  const checkedAt = history.runs.at(-1).checkedAt;
  const responding = rows.filter((row) => row.summary.last?.ok).length;
  return `${config.sites.length} sites in this record. ${responding} responding at the last check, ${formatStamp(checkedAt)}.`;
}

export function renderStatusPage({ config, history }) {
  const rows = config.sites.map((site) => ({
    site,
    summary: summarizeSeries(siteSeries(history, site.slug)),
  }));
  const chart = buildChart(config, history);
  const hasSamples = chart.datasets.some((dataset) => dataset.data.some((value) => value != null));
  const chartSection = hasSamples
    ? `
    <section class="mt-16">
      <h2 class="section-title tracking-[-0.02em]">Response time</h2>
      <p class="mt-3 max-w-[65ch] text-[#3c5158]">Milliseconds from each retained check. A gap in the line means that run had no sample.</p>
      <div class="mt-6 h-80 border border-[#c3d2d8] bg-[#eef4f6] px-3 py-4 sm:px-5">
        <canvas id="latency-chart" role="img" aria-label="Response time in milliseconds for each site"></canvas>
      </div>
    </section>`
    : `
    <section class="mt-16">
      <h2 class="section-title tracking-[-0.02em]">Response time</h2>
      <p class="mt-3 max-w-[65ch] text-[#3c5158]">The chart starts after the first check returns a sample.</p>
    </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Uptime and response-time record published by site-pulse.">
  <meta name="theme-color" content="#e6eef1">
  <title>Site Pulse</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23e6eef1'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%230d6846'/%3E%3C/svg%3E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,560;12..96,680&family=IBM+Plex+Mono:wght@400;500&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root { color-scheme: light; }
    html { scrollbar-color: #b7c8ce #e6eef1; }
    body {
      margin: 0;
      background: #e6eef1;
      color: #132228;
      font-family: Outfit, sans-serif;
      font-size: 1.0625rem;
      line-height: 1.5;
    }
    h1.font-display {
      font-size: 3.15rem;
      line-height: 1.02;
      font-weight: 680;
    }
    h2.section-title {
      font-size: 1.5rem;
      line-height: 1.25;
      font-weight: 560;
    }
    @media (min-width: 40rem) {
      h1.font-display { font-size: 3.75rem; }
    }
    .font-display { font-family: "Bricolage Grotesque", sans-serif; }
    .font-mono { font-family: "IBM Plex Mono", ui-monospace, monospace; }
    ::selection { background: #c5e0d4; color: #132228; }
    a:focus-visible { outline: 2px solid #132228; outline-offset: 3px; }
    .dot {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 999px;
      background: currentColor;
      display: inline-block;
    }
    .status-up .dot { animation: pulse-dot 2.4s ease-out infinite; }
    @keyframes pulse-dot {
      0% { box-shadow: 0 0 0 0 rgba(13, 104, 70, 0.45); }
      70% { box-shadow: 0 0 0 8px rgba(13, 104, 70, 0); }
      100% { box-shadow: 0 0 0 0 rgba(13, 104, 70, 0); }
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    @media (max-width: 700px) {
      table.ledger thead {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
      }
      table.ledger tr {
        display: block;
        padding: 0.45rem 0 0.85rem;
        border-bottom: 1px solid #c3d2d8;
      }
      table.ledger td {
        display: block;
        border-bottom-width: 0;
        padding-top: 0.55rem;
        padding-bottom: 0.1rem;
      }
      table.ledger td::before {
        content: attr(data-label);
        display: block;
        margin-bottom: 0.12rem;
        color: #3c5158;
        font-family: Outfit, sans-serif;
        font-size: 0.8rem;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .status-up .dot { animation: none; }
    }
  </style>
</head>
<body class="bg-[#e6eef1] text-[#132228] antialiased">
  <div class="mx-auto max-w-5xl px-6 py-12 sm:py-16">
    <header class="border-t-[3px] border-[#132228] pt-6">
      <h1 class="font-display tracking-[-0.03em] text-balance">Site Pulse</h1>
      <p class="mt-4 max-w-[65ch] text-lg text-[#3c5158]">A record of who answered, and how long they took. The checks run on a schedule. This page is what they leave behind.</p>
      <p class="mt-6 text-[#3c5158]">${escapeHtml(summaryCopy(config, history, rows))}</p>
    </header>
    <section class="mt-14">
      <h2 class="section-title tracking-[-0.02em]">Last check</h2>
      <p class="mt-3 max-w-[65ch] text-[#3c5158]">Uptime is the share of retained checks that came back with the expected status.</p>
      <div class="mt-6 overflow-x-auto">
        <table class="ledger w-full border-collapse text-left">
          <caption class="sr-only">Status of each configured site</caption>
          <thead>
            <tr class="text-sm text-[#3c5158]">
              <th scope="col" class="border-b border-[#132228] px-3 py-2 font-medium">Site</th>
              <th scope="col" class="border-b border-[#132228] px-3 py-2 font-medium">Status</th>
              <th scope="col" class="border-b border-[#132228] px-3 py-2 font-medium">Code</th>
              <th scope="col" class="border-b border-[#132228] px-3 py-2 font-medium">Latency</th>
              <th scope="col" class="border-b border-[#132228] px-3 py-2 font-medium">Uptime</th>
            </tr>
          </thead>
          <tbody>${rows.map((row) => renderRow(row.site, row.summary)).join('')}
          </tbody>
        </table>
      </div>
    </section>
    ${chartSection}
    <footer class="mt-16 border-t border-[#c3d2d8] pt-6 text-sm text-[#3c5158]">
      <p>Built by <a class="underline decoration-[#9eb4bc] underline-offset-4 hover:decoration-[#132228]" href="https://enrique-lab.my.id">Enrique Muhammad</a>. Checks are committed from GitHub Actions. <a class="underline decoration-[#9eb4bc] underline-offset-4 hover:decoration-[#132228]" href="${escapeHtml(config.repository)}">Source</a> is MIT.</p>
    </footer>
  </div>
  <script type="application/json" id="pulse-data">${safeJson(chart)}</script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  <script>
    const payload = JSON.parse(document.getElementById('pulse-data').textContent);
    const canvas = document.getElementById('latency-chart');
    if (canvas && payload.datasets.some((set) => set.data.some((value) => value != null))) {
      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: payload.labels,
          datasets: payload.datasets.map((set) => ({
            label: set.label,
            data: set.data,
            borderColor: set.color,
            backgroundColor: set.color,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.25,
            spanGaps: false,
          })),
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: '#3c5158',
                boxWidth: 12,
                boxHeight: 12,
                font: { family: 'Outfit, sans-serif', size: 13 },
              },
            },
          },
          scales: {
            x: {
              ticks: {
                color: '#3c5158',
                maxRotation: 0,
                autoSkip: true,
                font: { family: 'IBM Plex Mono, monospace', size: 11 },
              },
              grid: { color: '#d3e0e4' },
            },
            y: {
              beginAtZero: true,
              ticks: {
                color: '#3c5158',
                callback: (value) => value + ' ms',
                font: { family: 'IBM Plex Mono, monospace', size: 11 },
              },
              grid: { color: '#d3e0e4' },
            },
          },
        },
      });
      void chart;
    }
  </script>
</body>
</html>
`;
}
