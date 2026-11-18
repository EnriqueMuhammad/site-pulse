import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig, parseConfig, slugify } from '../src/config.js';

test('slugify folds case, accents, and punctuation into a url slug', () => {
  assert.equal(slugify('GitHub'), 'github');
  assert.equal(slugify('Enrique Lab'), 'enrique-lab');
  assert.equal(slugify('Café Status!'), 'cafe-status');
});

test('parseConfig applies defaults and builds slugs', () => {
  const config = parseConfig(`
sites:
  - name: GitHub
    url: https://github.com
`);

  assert.equal(config.timeoutMs, 10000);
  assert.equal(config.retention, 336);
  assert.equal(config.repository, 'https://github.com/EnriqueMuhammad/site-pulse');
  assert.deepEqual(config.sites, [
    {
      name: 'GitHub',
      slug: 'github',
      url: 'https://github.com',
      expect: 200,
    },
  ]);
});

test('parseConfig keeps an explicit expected status, timeout, retention, and repository', () => {
  const config = parseConfig(`
timeoutMs: 1500
retention: 10
repository: https://github.com/example/status
sites:
  - name: Google
    url: https://www.google.com
    expect: 204
`);

  assert.equal(config.timeoutMs, 1500);
  assert.equal(config.retention, 10);
  assert.equal(config.repository, 'https://github.com/example/status');
  assert.equal(config.sites[0].expect, 204);
});

test('parseConfig rejects an empty site list, bad urls, duplicates, and unsafe numbers', () => {
  assert.throws(() => parseConfig('sites: []'), /at least one site/i);
  assert.throws(() => parseConfig(`
sites:
  - name: Files
    url: file:///etc/passwd
`), /http/i);
  assert.throws(() => parseConfig(`
sites:
  - name: GitHub
    url: https://github.com
  - name: github
    url: https://example.com
`), /duplicate site slug "github"/i);
  assert.throws(() => parseConfig(`
sites:
  - name: Site Pulse
    url: https://example.com
`), /reserved/i);
  assert.throws(() => parseConfig(`
timeoutMs: 10
sites:
  - name: GitHub
    url: https://github.com
`), /timeoutMs/i);
  assert.throws(() => parseConfig(`
retention: 0
sites:
  - name: GitHub
    url: https://github.com
`), /retention/i);
});

test('loadConfig reads a file and reports a missing path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'site-pulse-config-'));
  const path = join(dir, 'sites.yml');
  await writeFile(path, `
sites:
  - name: GitHub
    url: https://github.com
`);

  const config = await loadConfig(path);
  assert.equal(config.sites[0].slug, 'github');

  await assert.rejects(loadConfig(join(dir, 'missing.yml')), /Config file not found/);
});
