import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderStatusPage } from '../src/page.js';

const config = {
  repository: 'https://github.com/EnriqueMuhammad/site-pulse',
  sites: [
    { name: 'GitHub', slug: 'github', url: 'https://github.com', expect: 200 },
    { name: 'A <b>tag</b>', slug: 'tag', url: 'https://example.com/a?b=1&c=2', expect: 200 },
  ],
};

test('renderStatusPage shows the latest ledger, chart data, and required assets', () => {
  const html = renderStatusPage({
    config,
    history: {
      version: 1,
      runs: [
        {
          checkedAt: '2026-11-18T00:00:00.000Z',
          results: [
            {
              name: 'GitHub',
              slug: 'github',
              url: 'https://github.com',
              expect: 200,
              status: 200,
              latencyMs: 120,
              ok: true,
              error: null,
            },
            {
              name: 'A <b>tag</b>',
              slug: 'tag',
              url: 'https://example.com/a?b=1&c=2',
              expect: 200,
              status: 200,
              latencyMs: 80,
              ok: true,
              error: null,
            },
          ],
        },
        {
          checkedAt: '2026-11-18T00:30:00.000Z',
          results: [
            {
              name: 'GitHub',
              slug: 'github',
              url: 'https://github.com',
              expect: 200,
              status: 200,
              latencyMs: 90,
              ok: true,
              error: null,
            },
            {
              name: 'A <b>tag</b>',
              slug: 'tag',
              url: 'https://example.com/a?b=1&c=2',
              expect: 200,
              status: 500,
              latencyMs: 70,
              ok: false,
              error: 'expected 200, got 500',
            },
          ],
        },
      ],
    },
  });

  assert.match(html, /<title>Site Pulse<\/title>/);
  assert.match(html, /cdn\.tailwindcss\.com/);
  assert.match(html, /chart\.umd\.min\.js/);
  assert.match(html, /id="latency-chart"/);
  assert.match(html, />GitHub</);
  assert.match(html, /90 ms/);
  assert.match(html, /70 ms/);
  assert.match(html, /"data":\[120,90\]/);
  assert.match(html, />Up</);
  assert.match(html, />Down</);
  assert.match(html, /50%/);
  assert.match(html, /100%/);
  assert.match(html, /https:\/\/github\.com\/EnriqueMuhammad\/site-pulse/);
  assert.match(html, /A &lt;b&gt;tag&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>tag<\/b>/);
  assert.match(html, /&amp;c=2/);
  assert.match(html, /"label":"GitHub"/);
  assert.match(html, /18 Nov 00:00/);
  assert.match(html, /18 Nov 00:30/);
});

test('renderStatusPage escapes script breakouts and explains an empty record', () => {
  const html = renderStatusPage({
    config: {
      repository: 'https://github.com/EnriqueMuhammad/site-pulse',
      sites: [
        {
          name: '</script><script>alert(1)</script>',
          slug: 'xss',
          url: 'https://example.com',
          expect: 200,
        },
      ],
    },
    history: { version: 1, runs: [] },
  });

  assert.match(html, /No checks have been recorded yet/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /\\u003c\/script\\u003e/);
});
