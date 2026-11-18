import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBadges } from '../src/badges.js';

const config = {
  sites: [
    { name: 'GitHub', slug: 'github', url: 'https://github.com', expect: 200 },
    { name: 'Google', slug: 'google', url: 'https://www.google.com', expect: 200 },
    { name: 'Quiet', slug: 'quiet', url: 'https://example.com', expect: 200 },
  ],
};

test('buildBadges describes the latest result for each site and the whole set', () => {
  const history = {
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
            name: 'Google',
            slug: 'google',
            url: 'https://www.google.com',
            expect: 200,
            status: 500,
            latencyMs: 80,
            ok: false,
            error: 'expected 200, got 500',
          },
        ],
      },
    ],
  };

  const badges = buildBadges(config, history);

  assert.deepEqual(badges['github.json'], {
    schemaVersion: 1,
    label: 'GitHub',
    message: 'up 120ms',
    color: '1b5e3b',
    labelColor: '1c1915',
  });
  assert.equal(badges['google.json'].message, 'down');
  assert.equal(badges['google.json'].color, '9f2d20');
  assert.equal(badges['quiet.json'].message, 'no data');
  assert.equal(badges['quiet.json'].color, '8a8175');
  assert.equal(badges['site-pulse.json'].message, '1/3 up');
  assert.equal(badges['site-pulse.json'].color, '9a3412');
});

test('buildBadges uses an all-clear color only when every site is up', () => {
  const history = {
    version: 1,
    runs: [
      {
        checkedAt: '2026-11-18T00:00:00.000Z',
        results: config.sites.map((site) => ({
          ...site,
          status: 200,
          latencyMs: 40,
          ok: true,
          error: null,
        })),
      },
    ],
  };

  const badges = buildBadges(config, history);
  assert.equal(badges['site-pulse.json'].message, '3/3 up');
  assert.equal(badges['site-pulse.json'].color, '1b5e3b');
});
