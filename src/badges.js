import { siteSeries, summarizeSeries } from './history.js';

const COLOR = {
  up: '1b5e3b',
  down: '9f2d20',
  partial: '9a3412',
  muted: '8a8175',
  label: '1c1915',
};

function badge(label, message, color) {
  return {
    schemaVersion: 1,
    label,
    message,
    color,
    labelColor: COLOR.label,
  };
}

function siteBadge(site, summary) {
  if (!summary.last) {
    return badge(site.name, 'no data', COLOR.muted);
  }
  if (!summary.last.ok) {
    return badge(site.name, 'down', COLOR.down);
  }
  const latency = summary.last.latencyMs;
  const message = typeof latency === 'number' ? `up ${latency}ms` : 'up';
  return badge(site.name, message, COLOR.up);
}

export function buildBadges(config, history) {
  const badges = {};
  let up = 0;
  let observed = 0;

  for (const site of config.sites) {
    const summary = summarizeSeries(siteSeries(history, site.slug));
    badges[`${site.slug}.json`] = siteBadge(site, summary);
    if (summary.last) {
      observed += 1;
      if (summary.last.ok) {
        up += 1;
      }
    }
  }

  let message = 'no data';
  let color = COLOR.muted;
  if (observed > 0) {
    message = `${up}/${config.sites.length} up`;
    if (up === config.sites.length) {
      color = COLOR.up;
    } else if (up === 0) {
      color = COLOR.down;
    } else {
      color = COLOR.partial;
    }
  }

  badges['site-pulse.json'] = badge('site pulse', message, color);
  return badges;
}
