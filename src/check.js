export const USER_AGENT = 'site-pulse/1.0 (+https://github.com/EnriqueMuhammad/site-pulse)';

function cleanError(message) {
  const text = String(message || 'request failed').replace(/\s+/g, ' ').trim();
  return text.slice(0, 300);
}

export async function checkSite(site, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10000;
  const started = performance.now();

  try {
    const response = await fetchImpl(site.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': USER_AGENT,
        accept: '*/*',
      },
    });
    const latencyMs = Math.max(0, Math.round(performance.now() - started));

    try {
      await response.body?.cancel?.();
    } catch {
      // The status line is the sample. A failed cancel does not change it.
    }

    const ok = response.status === site.expect;
    return {
      name: site.name,
      slug: site.slug,
      url: site.url,
      expect: site.expect,
      status: response.status,
      latencyMs,
      ok,
      error: ok ? null : `expected ${site.expect}, got ${response.status}`,
    };
  } catch (error) {
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    return {
      name: site.name,
      slug: site.slug,
      url: site.url,
      expect: site.expect,
      status: null,
      latencyMs,
      ok: false,
      error: timedOut ? `timeout after ${timeoutMs}ms` : cleanError(error.message),
    };
  }
}

export async function checkAll(sites, options = {}) {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const results = new Array(sites.length);
  let cursor = 0;

  async function worker() {
    while (cursor < sites.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await checkSite(sites[index], options);
    }
  }

  const workers = Math.min(concurrency, sites.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return { checkedAt, results };
}
