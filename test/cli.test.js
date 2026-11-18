import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/cli.js', ...args], { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('check writes history, badges, and a page, and render does not add a run', async () => {
  const server = await listen((request, response) => {
    if (request.url === '/slow') {
      return;
    }
    const status = request.url === '/bad' ? 500 : 200;
    response.writeHead(status, { 'content-type': 'text/plain' });
    response.end('ok');
  });

  const { port } = server.address();
  const dir = await mkdtemp(join(tmpdir(), 'site-pulse-cli-'));
  const configPath = join(dir, 'sites.yml');
  const historyPath = join(dir, 'history.json');
  const csvPath = join(dir, 'history.csv');
  const outDir = join(dir, 'public');
  const { writeFile } = await import('node:fs/promises');

  await writeFile(configPath, `
timeoutMs: 200
retention: 5
repository: https://github.com/EnriqueMuhammad/site-pulse
sites:
  - name: Ok Site
    url: http://127.0.0.1:${port}/ok
    expect: 200
  - name: Bad Site
    url: http://127.0.0.1:${port}/bad
    expect: 200
  - name: Slow Site
    url: http://127.0.0.1:${port}/slow
    expect: 200
`);

  try {
    const args = ['--config', configPath, '--history', historyPath, '--csv', csvPath, '--out', outDir];
    const first = await runCli(['check', ...args]);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /UP\s+Ok Site\s+200/);
    assert.match(first.stdout, /DOWN\s+Bad Site\s+500/);
    assert.match(first.stdout, /DOWN\s+Slow Site/);
    assert.match(first.stdout, /timeout after 200ms/);

    const history = JSON.parse(await readFile(historyPath, 'utf8'));
    assert.equal(history.runs.length, 1);
    assert.equal(history.runs[0].results.length, 3);

    const csv = await readFile(csvPath, 'utf8');
    assert.match(csv, /^checkedAt,name,slug/);
    assert.match(csv, /Ok Site/);

    const page = await readFile(join(outDir, 'index.html'), 'utf8');
    assert.match(page, /Ok Site/);
    assert.match(page, /cdn\.tailwindcss\.com/);

    const badge = JSON.parse(await readFile(join(outDir, 'badges', 'ok-site.json'), 'utf8'));
    assert.equal(badge.schemaVersion, 1);
    assert.match(badge.message, /^up /);
    const slow = JSON.parse(await readFile(join(outDir, 'badges', 'slow-site.json'), 'utf8'));
    assert.equal(slow.message, 'down');

    const before = await readFile(historyPath, 'utf8');
    const rendered = await runCli(['render', ...args]);
    assert.equal(rendered.code, 0, rendered.stderr);
    assert.equal(await readFile(historyPath, 'utf8'), before);

    const second = await runCli(['check', ...args]);
    assert.equal(second.code, 0, second.stderr);
    const appended = JSON.parse(await readFile(historyPath, 'utf8'));
    assert.equal(appended.runs.length, 2);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test('the cli reports usage and a missing config file', async () => {
  const help = await runCli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage/);

  const missing = await runCli(['check', '--config', join(tmpdir(), 'site-pulse-missing.yml')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Config file not found/);

  const unknown = await runCli(['dance']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Usage/);
});
