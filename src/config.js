import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

export const DEFAULT_REPOSITORY = 'https://github.com/EnriqueMuhammad/site-pulse';

const RESERVED_SLUGS = new Set(['site-pulse', 'status', 'history', 'index']);

function fail(message) {
  throw new Error(message);
}

export function slugify(name) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    fail(`Cannot build a slug from "${name}".`);
  }

  return slug;
}

function readUrl(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`Site "${name}" needs a url.`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`Site "${name}" has an invalid url.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(`Site "${name}" must use an http or https url.`);
  }

  return value;
}

export function parseConfig(text) {
  const raw = parse(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Config must be a YAML object.');
  }

  const timeoutMs = raw.timeoutMs ?? 10000;
  const retention = raw.retention ?? 336;
  const repository = raw.repository ?? DEFAULT_REPOSITORY;

  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    fail('timeoutMs must be an integer from 100 to 60000.');
  }
  if (!Number.isInteger(retention) || retention < 1 || retention > 5000) {
    fail('retention must be an integer from 1 to 5000.');
  }
  if (typeof repository !== 'string' || !/^https:\/\/\S+$/.test(repository)) {
    fail('repository must be an https URL.');
  }
  if (!Array.isArray(raw.sites) || raw.sites.length === 0) {
    fail('Add at least one site.');
  }

  const sites = raw.sites.map((site, index) => {
    if (!site || typeof site !== 'object' || Array.isArray(site)) {
      fail(`Site ${index + 1} must be a mapping.`);
    }
    if (typeof site.name !== 'string' || site.name.trim() === '') {
      fail(`Site ${index + 1} needs a name.`);
    }

    const name = site.name.trim();
    const expect = site.expect ?? 200;
    if (!Number.isInteger(expect) || expect < 100 || expect > 599) {
      fail(`Site "${name}" expect must be an HTTP status from 100 to 599.`);
    }

    const slug = slugify(name);
    if (RESERVED_SLUGS.has(slug)) {
      fail(`Site slug "${slug}" is reserved.`);
    }

    return {
      name,
      slug,
      url: readUrl(name, site.url),
      expect,
    };
  });

  const seen = new Set();
  for (const site of sites) {
    if (seen.has(site.slug)) {
      fail(`Duplicate site slug "${site.slug}".`);
    }
    seen.add(site.slug);
  }

  return { timeoutMs, retention, repository, sites };
}

export async function loadConfig(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Config file not found: ${path}`, { cause: error });
    }
    throw error;
  }

  try {
    return parseConfig(text);
  } catch (error) {
    throw new Error(`Invalid config in ${path}: ${error.message}`, { cause: error });
  }
}
