import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendRun,
  emptyHistory,
  historyToCsv,
  parseHistory,
  siteSeries,
  summarizeSeries,
} from '../src/history.js';

const run = (checkedAt, ok, latencyMs = 100) => ({
  checkedAt,
  results: [
    {
      name: 'GitHub',
      slug: 'github',
      url: 'https://github.com',
      expect: 200,
      status: ok ? 200 : 500,
      latencyMs,
      ok,
      error: ok ? null : 'expected 200, got 500',
    },
  ],
});

test('appendRun keeps the newest runs up to retention', () => {
  const history = appendRun(emptyHistory(), run('2026-11-18T00:00:00.000Z', true), 2);
  const withSecond = appendRun(history, run('2026-11-18T00:30:00.000Z', true), 2);
  const withThird = appendRun(withSecond, run('2026-11-18T01:00:00.000Z', false, 80), 2);

  assert.deepEqual(
    withThird.runs.map((item) => item.checkedAt),
    ['2026-11-18T00:30:00.000Z', '2026-11-18T01:00:00.000Z'],
  );
  assert.equal(withThird.version, 1);
});

test('appendRun rejects a retention that would not trim', () => {
  assert.throws(() => appendRun(emptyHistory(), run('2026-11-18T00:00:00.000Z', true), 0), /retention/);
});

test('parseHistory accepts a runs array and rejects broken documents', () => {
  const history = parseHistory(JSON.stringify({
    runs: [run('2026-11-18T00:00:00.000Z', true)],
  }));
  assert.equal(history.runs.length, 1);

  assert.throws(() => parseHistory('{'), /valid JSON/);
  assert.throws(() => parseHistory('{"runs":{}}'), /runs array/);
  assert.throws(() => parseHistory('{"runs":[{}]}'), /checkedAt/);
});

test('historyToCsv escapes commas and quotes and leaves nulls empty', () => {
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
            status: null,
            latencyMs: null,
            ok: false,
            error: 'boom, "quoted"',
          },
        ],
      },
    ],
  };

  const csv = historyToCsv(history);
  assert.equal(
    csv,
    [
      'checkedAt,name,slug,url,expect,status,latencyMs,ok,error',
      '2026-11-18T00:00:00.000Z,GitHub,github,https://github.com,200,,,false,"boom, ""quoted"""',
      '',
    ].join('\n'),
  );
});

test('siteSeries skips runs that do not mention the slug and summarizes them', () => {
  const history = {
    version: 1,
    runs: [
      run('2026-11-18T00:00:00.000Z', true, 100),
      {
        checkedAt: '2026-11-18T00:30:00.000Z',
        results: [
          {
            name: 'Google',
            slug: 'google',
            url: 'https://www.google.com',
            expect: 200,
            status: 200,
            latencyMs: 50,
            ok: true,
            error: null,
          },
        ],
      },
      run('2026-11-18T01:00:00.000Z', false, 300),
    ],
  };

  const points = siteSeries(history, 'github');
  assert.deepEqual(points.map((point) => point.checkedAt), [
    '2026-11-18T00:00:00.000Z',
    '2026-11-18T01:00:00.000Z',
  ]);

  const summary = summarizeSeries(points);
  assert.equal(summary.total, 2);
  assert.equal(summary.up, 1);
  assert.equal(summary.uptime, 0.5);
  assert.equal(summary.avgLatencyMs, 200);
  assert.equal(summary.last.ok, false);
  assert.equal(summarizeSeries([]).uptime, null);
});
