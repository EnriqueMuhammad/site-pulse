import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
  const shotPath = process.env.SHOT_PATH || join(root, 'docs', 'status-page.png');
const chromeBin = process.env.CHROME_PATH || 'google-chrome';
const debugPort = 9333;

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.css', 'text/css; charset=utf-8'],
]);

function startServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const path = join(publicDir, requested);
    if (!path.startsWith(`${publicDir}${sep}`)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    try {
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': types.get(extname(path)) || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function launchChrome() {
  const child = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let logs = '';
  child.stderr.setEncoding('utf8');
  child.stdout.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  return { child, logs: () => logs };
}

async function waitForJson(url) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      }
    } catch {
      // Chrome is still opening the debugging port.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error('Chrome DevTools did not open.');
}

function connect(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Map();

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('DevTools socket failed.')));
  });

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
        return;
      }
      resolve(message.result);
      return;
    }
    if (message.method) {
      const key = `${message.sessionId || ''}:${message.method}`;
      for (const listener of listeners.get(key) || []) {
        listener(message.params);
      }
    }
  });

  return {
    ready,
    send(method, params = {}, sessionId) {
      const messageId = id + 1;
      id = messageId;
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
        const payload = { id: messageId, method, params };
        if (sessionId) {
          payload.sessionId = sessionId;
        }
        ws.send(JSON.stringify(payload));
      });
    },
    once(sessionId, method) {
      const key = `${sessionId}:${method}`;
      return new Promise((resolve) => {
        const list = listeners.get(key) || [];
        const handler = (params) => {
          listeners.set(key, (listeners.get(key) || []).filter((item) => item !== handler));
          resolve(params);
        };
        list.push(handler);
        listeners.set(key, list);
      });
    },
    close() {
      ws.close();
    },
  };
}

async function capture(pageUrl) {
  const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
  const browser = connect(version.webSocketDebuggerUrl);
  await browser.ready;
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);

  await send('Page.enable');
  await send('Runtime.enable');
  const width = Number(process.env.SHOT_WIDTH || 1280);
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 2,
    mobile: width < 700,
  });
  const loaded = browser.once(sessionId, 'Page.loadEventFired');
  await send('Page.navigate', { url: pageUrl });
  await loaded;

  const ready = await send('Runtime.evaluate', {
    expression: `(() => new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const canvas = document.getElementById('latency-chart');
        const outfit = document.fonts.check('400 16px Outfit');
        const display = document.fonts.check('680 64px "Bricolage Grotesque"');
        const drawn = Boolean(canvas && canvas.width > 0);
        if ((outfit && display && drawn) || Date.now() - started > 12000) {
          resolve({
            outfit,
            display,
            drawn,
            body: getComputedStyle(document.body).fontFamily,
            h1: getComputedStyle(document.querySelector('h1')).fontFamily,
            h1Size: getComputedStyle(document.querySelector('h1')).fontSize,
            h2Size: getComputedStyle(document.querySelector('h2')).fontSize,
          });
          return;
        }
        setTimeout(tick, 100);
      };
      document.fonts.ready.then(tick);
    }))()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(JSON.stringify(ready.result?.value));

  const measured = await send('Runtime.evaluate', {
    expression: 'Math.ceil(document.documentElement.scrollHeight)',
    returnByValue: true,
  });
  const height = Math.max(900, measured.result?.value || 900);
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: width < 700,
  });
  await send('Runtime.evaluate', {
    expression: 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    awaitPromise: true,
  });

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  browser.close();
  return Buffer.from(shot.data, 'base64');
}

const server = await startServer();
const chrome = launchChrome();
try {
  const { port } = server.address();
  const png = await capture(`http://127.0.0.1:${port}/`);
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(shotPath, png);
  console.log(`Wrote ${shotPath}`);
} catch (error) {
  console.error(error.message);
  console.error(chrome.logs());
  process.exitCode = 1;
} finally {
  chrome.child.kill();
  server.closeAllConnections?.();
  server.close();
}
