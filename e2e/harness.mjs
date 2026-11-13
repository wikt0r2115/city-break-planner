import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executableEnv = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const buildProcesses = new Set();
const activeApps = new Set();

async function run(command, args, cwd) {
  // Windows invokes the fixed Maven and npm .cmd build commands through cmd.exe.
  const child = spawn(command, args, {
    cwd, env: executableEnv, stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32',
  });
  buildProcesses.add(child);
  try {
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(`${path.basename(command)} ${args.join(' ')} failed (${code}).`);
  } finally { buildProcesses.delete(child); }
}

export async function stopBuilds() {
  await Promise.all([...buildProcesses].map((child) => stopProcess({ child })));
}

export async function stopApps({ keep = false } = {}) {
  await Promise.all([...activeApps].map((app) => app.stop({ keep })));
}

export async function buildApp() {
  if (process.env.E2E_SKIP_BUILD === '1') return;
  await run(process.platform === 'win32' ? 'mvnw.cmd' : './mvnw', ['-B', '-ntp', 'package', '-DskipTests'], path.join(root, 'backend'));
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], path.join(root, 'frontend'));
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], path.join(root, 'frontend'));
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function startProcess(command, args, cwd, env, logPath) {
  const log = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
  const child = spawn(command, args, { cwd, env: { ...executableEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let error;
  child.on('error', (failure) => { error = failure; });
  child.once('close', () => log.end());
  return { child, logPath, get error() { return error; } };
}

async function stopProcess(process) {
  if (!process || process.child.exitCode !== null || process.child.signalCode !== null) return;
  const exited = once(process.child, 'exit');
  process.child.kill('SIGTERM');
  let timer;
  const stopped = await Promise.race([exited.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), 3000); })]);
  clearTimeout(timer);
  if (!stopped) { process.child.kill('SIGKILL'); await exited; }
}

async function ready(process, url) {
  for (let count = 0; count < 200; count++) {
    if (process.error) throw process.error;
    if (process.child.exitCode !== null || process.child.signalCode !== null)
      throw new Error(`Test server exited before readiness; inspect ${process.logPath}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await pause(100);
  }
  throw new Error(`Test server did not become ready; inspect ${process.logPath}.`);
}

export async function startApp({ mode = 'demo', controlledFaults = false, aiProvider = 'off' } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'city-break-e2e-'));
  const apiPort = await freePort();
  let frontendPort = await freePort();
  while (frontendPort === apiPort) frontendPort = await freePort();
  const api = `http://127.0.0.1:${apiPort}/api/v1`;
  const url = `http://127.0.0.1:${frontendPort}`;
  const jar = path.join(root, 'backend', 'target', 'city-break-planner-0.0.1-SNAPSHOT.jar');
  const vite = path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(jar) || !existsSync(vite)) {
    await fs.rm(directory, { recursive: true, force: true });
    throw new Error('Missing build or frontend dependencies; omit E2E_SKIP_BUILD or prepare the checkout first.');
  }
  let backend;
  let frontend;
  let proxy;
  let searchFault;
  let stopping;
  let stopped = false;
  const launchBackend = async (dataMode) => {
    backend = startProcess('java', ['-jar', jar], root, {
      SERVER_ADDRESS: '127.0.0.1', SERVER_PORT: String(apiPort),
      SPRING_DATASOURCE_URL: `jdbc:sqlite:${path.join(directory, 'plans.db')}`,
      APP_CORS_ALLOWED_ORIGINS: url, APP_FRONTEND_BASE_URL: url, APP_DATA_MODE: dataMode,
      APP_AI_PROVIDER: aiProvider,
    }, path.join(directory, 'backend.log'));
    await ready(backend, `${api}/health`);
  };
  const app = {
    api, url, directory,
    setSearchFault(status) { searchFault = status; },
    async restartBackend(dataMode = mode) { await stopProcess(backend); await launchBackend(dataMode); },
    async stop({ keep = false } = {}) {
      if (stopping) return stopping;
      stopped = true;
      stopping = (async () => {
        await Promise.all([stopProcess(frontend), stopProcess(backend)]);
        if (proxy) { proxy.closeAllConnections(); await new Promise((resolve) => proxy.close(resolve)); }
        if (!keep) await fs.rm(directory, { recursive: true, force: true });
        activeApps.delete(app);
      })();
      return stopping;
    },
  };
  activeApps.add(app);
  try {
    await launchBackend(mode);
    if (stopped) throw new Error('Test environment was stopped during startup.');
    let browserApi = api;
    if (controlledFaults) {
      // Only this test server injects failures. Successful flows reach the real Spring API.
      proxy = http.createServer(async (request, response) => {
        try {
          const location = new URL(request.url, 'http://localhost');
          const chunks = [];
          let bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > 1_000_000) { response.writeHead(413).end(); return; }
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks);
          if (searchFault && request.method === 'POST' && location.pathname === '/api/v1/searches') {
            const criteria = JSON.parse(body.toString('utf8'));
            response.writeHead(200, { 'Content-Type': 'application/json', ...(request.headers.origin === url ? { 'Access-Control-Allow-Origin': url } : {}) });
            response.end(JSON.stringify({ searchId: 'e2e-controlled-fault', criteria, status: searchFault,
              roundTripOptions: [], attractions: [], testData: true,
              sources: [{ sourceId: 'e2e-controlled-fault', url: null, checkedAt: new Date().toISOString(),
                status: searchFault === 'NO_CONNECTION' ? 'NO_CONNECTION' : 'PROVIDER_ERROR',
                message: 'Kontrolowana odpowiedź HTTP testu E2E, nie dane operatora.' }],
            }));
            return;
          }
          const headers = { ...request.headers };
          delete headers.host; delete headers.connection; delete headers['content-length'];
          const upstream = await fetch(`http://127.0.0.1:${apiPort}${location.pathname}${location.search}`, {
            method: request.method, headers, ...(body.length ? { body } : {}), signal: AbortSignal.timeout(30000),
          });
          response.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) response.setHeader(key, value); });
          response.end(Buffer.from(await upstream.arrayBuffer()));
        } catch { if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ detail: 'Kontrolowany serwer testowy nie mógł przekazać żądania.' })); }
      });
      proxy.listen(0, '127.0.0.1');
      await once(proxy, 'listening');
      browserApi = `http://127.0.0.1:${proxy.address().port}/api/v1`;
    }
    frontend = startProcess(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], path.join(root, 'frontend'), { VITE_API_BASE_URL: browserApi }, path.join(directory, 'frontend.log'));
    await ready(frontend, url);
    return app;
  } catch (error) { await app.stop({ keep: true }); throw error; }
}

export async function launchBrowser() {
  const configured = process.env.E2E_BROWSER_PATH;
  const localChrome = '/opt/google/chrome/chrome';
  const executablePath = configured || (existsSync(localChrome) ? localChrome : undefined);
  return chromium.launch({ executablePath, headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
}

export async function apiRequest(app, method, route, body, token) {
  const response = await fetch(`${app.api}${route}`, {
    method, signal: AbortSignal.timeout(30000),
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
}

export function futureDate(days) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days)).toISOString().slice(0, 10);
}

export const planInput = (plan) => ({
  criteria: plan.criteria,
  selectedRoundTrip: plan.selectedRoundTrip,
  items: plan.items.map((item) => ({
    id: item.id,
    attractionId: item.attractionId,
    startsAt: item.startsAt,
    visitMinutes: Math.round((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60000),
    automaticTime: item.automaticTime,
  })),
});
