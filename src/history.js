import { readFile } from 'node:fs/promises';

const CSV_COLUMNS = [
  'checkedAt',
  'name',
  'slug',
  'url',
  'expect',
  'status',
  'latencyMs',
  'ok',
  'error',
];

export function emptyHistory() {
  return { version: 1, runs: [] };
}

export function parseHistory(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('History file is not valid JSON.');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.runs)) {
    throw new Error('History file must be an object with a runs array.');
  }

  for (const run of value.runs) {
    if (!run || typeof run.checkedAt !== 'string' || !Array.isArray(run.results)) {
      throw new Error('History file has a run without checkedAt and results.');
    }
  }

  return { version: 1, runs: value.runs };
}

export function serializeHistory(history) {
  return `${JSON.stringify(history, null, 2)}\n`;
}

export function appendRun(history, run, retention) {
  if (!Number.isInteger(retention) || retention < 1) {
    throw new Error('retention must be a positive integer.');
  }

  return {
    version: 1,
    runs: [...history.runs, run].slice(-retention),
  };
}

function csvField(value) {
  if (value == null) {
    return '';
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function historyToCsv(history) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const run of history.runs) {
    for (const result of run.results) {
      const row = {
        checkedAt: run.checkedAt,
        name: result.name,
        slug: result.slug,
        url: result.url,
        expect: result.expect,
        status: result.status,
        latencyMs: result.latencyMs,
        ok: result.ok,
        error: result.error,
      };
      lines.push(CSV_COLUMNS.map((column) => csvField(row[column])).join(','));
    }
  }
  return `${lines.join('\n')}\n`;
}

export function siteSeries(history, slug) {
  const points = [];
  for (const run of history.runs) {
    const result = run.results.find((item) => item.slug === slug);
    if (!result) {
      continue;
    }
    points.push({
      checkedAt: run.checkedAt,
      status: result.status,
      latencyMs: result.latencyMs,
      ok: result.ok,
      error: result.error,
    });
  }
  return points;
}

export function summarizeSeries(points) {
  const total = points.length;
  const up = points.filter((point) => point.ok).length;
  const samples = points.filter((point) => typeof point.latencyMs === 'number');
  const avgLatencyMs = samples.length
    ? Math.round(samples.reduce((sum, point) => sum + point.latencyMs, 0) / samples.length)
    : null;

  return {
    total,
    up,
    uptime: total ? up / total : null,
    last: total ? points[total - 1] : null,
    avgLatencyMs,
  };
}

export async function readHistory(path) {
  try {
    return parseHistory(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return emptyHistory();
    }
    throw error;
  }
}
