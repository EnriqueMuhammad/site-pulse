#!/usr/bin/env node
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildBadges } from './badges.js';
import { checkAll } from './check.js';
import { loadConfig } from './config.js';
import { appendRun, historyToCsv, readHistory, serializeHistory } from './history.js';
import { renderStatusPage } from './page.js';

const HELP = `site-pulse — uptime checks for a static status page

Usage:
  site-pulse check  [--config sites.yml] [--history data/history.json] [--csv data/history.csv] [--out public]
  site-pulse render [--config sites.yml] [--history data/history.json] [--csv data/history.csv] [--out public]
  site-pulse --help

check   Request each site, append one run, and write history, badges, and the status page.
render  Rebuild the status page and badges from history already on disk.
`;

function parseArgs(argv) {
  const args = {
    command: null,
    config: 'sites.yml',
    history: 'data/history.json',
    csv: 'data/history.csv',
    out: 'public',
    help: false,
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) {
    args.command = rest.shift();
  }

  while (rest.length > 0) {
    const flag = rest.shift();
    if (flag === '--help' || flag === '-h') {
      args.help = true;
      continue;
    }
    const keys = {
      '--config': 'config',
      '--history': 'history',
      '--csv': 'csv',
      '--out': 'out',
    };
    const key = keys[flag];
    if (!key || rest.length === 0) {
      throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
    args[key] = rest.shift();
  }

  return args;
}

async function writeAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, path);
}

async function writePublic(outDir, config, history) {
  const badges = buildBadges(config, history);
  await writeAtomic(join(outDir, 'index.html'), renderStatusPage({ config, history }));
  await writeAtomic(join(outDir, 'history.json'), serializeHistory(history));
  await writeAtomic(join(outDir, '.nojekyll'), '');
  const badgeJson = Object.entries(badges).map(([name, badge]) => [
    join(outDir, 'badges', name),
    `${JSON.stringify(badge, null, 2)}\n`,
  ]);
  await Promise.all(badgeJson.map(([path, contents]) => writeAtomic(path, contents)));
}

function printRun(run) {
  const width = Math.max(...run.results.map((result) => result.name.length));
  const lines = run.results.map((result) => {
    const mark = result.ok ? 'UP  ' : 'DOWN';
    const status = result.status == null ? '—' : String(result.status);
    const detail = result.status == null ? result.error : `${result.latencyMs}ms`;
    return `${mark}  ${result.name.padEnd(width)}  ${status.padStart(3)}  ${detail}`;
  });
  return lines.join('\n');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(HELP);
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.command !== 'check' && args.command !== 'render') {
    console.error(HELP);
    process.exitCode = 1;
    return;
  }

  try {
    const config = await loadConfig(args.config);
    let history = await readHistory(args.history);
    if (args.command === 'check') {
      const run = await checkAll(config.sites, { timeoutMs: config.timeoutMs });
      history = appendRun(history, run, config.retention);
      await writeAtomic(args.history, serializeHistory(history));
      await writeAtomic(args.csv, historyToCsv(history));
      console.log(printRun(run));
      console.log(`Recorded ${run.results.length} results.`);
    }
    await writePublic(args.out, config, history);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

await main();
