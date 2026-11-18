import assert from 'node:assert/strict';
import { test } from 'node:test';
import { USER_AGENT, checkAll, checkSite } from '../src/check.js';

const site = {
  name: 'GitHub',
  slug: 'github',
  url: 'https://github.com',
  expect: 200,
};

test('checkSite records a matching response and cancels the body', async () => {
  let cancelled = false;
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return {
      status: 200,
      body: {
        cancel() {
          cancelled = true;
        },
      },
    };
  };

  const result = await checkSite(site, { fetchImpl, timeoutMs: 1000 });

  assert.equal(cancelled, true);
  assert.equal(seen.url, site.url);
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.redirect, 'follow');
  assert.equal(seen.init.headers['user-agent'], USER_AGENT);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.error, null);
  assert.equal(typeof result.latencyMs, 'number');
  assert.ok(result.latencyMs >= 0);
});

test('checkSite marks an unexpected status down without throwing', async () => {
  const fetchImpl = async () => ({ status: 503, body: { cancel() {} } });
  const result = await checkSite(site, { fetchImpl, timeoutMs: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /expected 200, got 503/);
});

test('checkSite reports a timeout when the abort signal fires', async () => {
  const fetchImpl = (_url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({ status: 200, body: { cancel() {} } });
    }, 500);
    init.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      const error = new Error('The operation was aborted due to timeout');
      error.name = init.signal.reason?.name || 'TimeoutError';
      reject(error);
    });
  });

  const result = await checkSite(site, { fetchImpl, timeoutMs: 40 });

  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.match(result.error, /timeout after 40ms/);
});

test('checkSite keeps network failures as down results', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  const result = await checkSite(site, { fetchImpl, timeoutMs: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.match(result.error, /fetch failed/);
});

test('checkAll preserves site order and shares one timestamp', async () => {
  const sites = [
    { ...site, name: 'Slow', slug: 'slow', url: 'https://slow.example' },
    { ...site, name: 'Fast', slug: 'fast', url: 'https://fast.example' },
  ];
  const fetchImpl = async (url) => {
    if (url.includes('slow')) {
      await new Promise((resolve) => {
        setTimeout(resolve, 40);
      });
    }
    return { status: 200, body: { cancel() {} } };
  };

  const run = await checkAll(sites, {
    fetchImpl,
    timeoutMs: 1000,
    now: () => new Date('2026-11-18T02:50:00.000Z'),
  });

  assert.equal(run.checkedAt, '2026-11-18T02:50:00.000Z');
  assert.deepEqual(run.results.map((result) => result.slug), ['slow', 'fast']);
  assert.equal(run.results.every((result) => result.ok), true);
});
