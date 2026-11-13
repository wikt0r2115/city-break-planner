import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { futureDate, launchBrowser, root } from './harness.mjs';

const execute = promisify(execFile);
const versions = await Promise.all([
  execute('docker', ['version', '--format', '{{.Server.Version}}']),
  execute('docker', ['compose', 'version', '--short']),
]);
const project = `city-break-test-${process.pid}-${Date.now()}`;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'city-break-docker-'));
const envFile = path.join(temporary, 'compose.env');
await fs.writeFile(envFile, '', { mode: 0o600 });
const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://localhost:${port}`;
const environment = { ...process.env, APP_PORT: String(port), APP_BIND_ADDRESS: '127.0.0.1',
  OPENAI_API_KEY: '' };
delete environment.APP_FRONTEND_BASE_URL;
delete environment.APP_CORS_ALLOWED_ORIGINS;
const composePrefix = ['compose', '--project-name', project, '--env-file', envFile, '--file', path.join(root, 'compose.yaml')];
let activeCommand;
let browser;
let browserPromise;
let stopping = false;
let cleanupPromise;

async function command(args, compose = true) {
  if (stopping && !(compose && args[0] === 'down')) throw new Error('Docker test was stopped.');
  const operation = execute('docker', compose ? [...composePrefix, ...args] : args,
    { cwd: root, env: environment, maxBuffer: 4 * 1024 * 1024, timeout: 900000 });
  activeCommand = operation.child;
  try { return await operation; }
  finally { activeCommand = undefined; }
}

function cleanup() {
  stopping = true;
  return cleanupPromise ||= (async () => {
    if (activeCommand && activeCommand.exitCode === null && activeCommand.signalCode === null) {
      const exited = once(activeCommand, 'exit');
      activeCommand.kill('SIGTERM');
      let timer;
      const result = await Promise.race([exited.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5000); })]);
      clearTimeout(timer);
      if (!result) { activeCommand?.kill('SIGKILL'); await exited; }
    }
    const ownedBrowser = browser || await browserPromise?.catch(() => undefined);
    await ownedBrowser?.close().catch(() => {});
    try { await command(['down', '--volumes', '--remove-orphans', '--rmi', 'local']); }
    finally { await fs.rm(temporary, { recursive: true, force: true }); }
  })();
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]])
  process.once(signal, () => { void cleanup().finally(() => process.exit(code)); });

async function request(method, route, body, token) {
  return fetch(`${origin}/api/v1${route}`, { method, signal: AbortSignal.timeout(20000),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function healthy() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (stopping) throw new Error('Docker test was stopped.');
    try {
      const response = await request('GET', '/health');
      if (response.ok && (await response.json()).database === 'UP') return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('The frontend proxy did not recover a healthy API.');
}

try {
  await command(['config', '--quiet']);
  console.log('Building and starting an isolated Docker Compose project…');
  await command(['build', '--pull', '--no-cache']);
  await command(['up', '--no-build', '--detach', '--wait', '--wait-timeout', '180']);
  await healthy();
  for (const service of ['backend', 'frontend']) {
    const id = (await command(['ps', '--quiet', service])).stdout.trim();
    const container = JSON.parse((await command(['inspect', id], false)).stdout)[0];
    assert.ok(container.Config.User && !['0', '0:0', 'root', 'root:root'].includes(container.Config.User), `${service} must run without root.`);
    if (service === 'backend') assert.ok(Object.values(container.NetworkSettings.Ports).every((bindings) => !bindings), 'The backend must not publish a host port.');
  }
  const missing = await request('GET', '/missing-docker-test');
  assert.equal(missing.status, 404);
  assert.ok(missing.headers.get('content-type')?.includes('application/problem+json'));
  const places = await request('GET', '/places');
  assert.equal(places.status, 200);
  assert.deepEqual((await places.json()).places.map((place) => place.value), ['Amsterdam', 'Londyn', 'Paryż']);
  if (stopping) throw new Error('Docker test was stopped.');
  browserPromise = launchBrowser();
  browser = await browserPromise;
  const context = await browser.newContext({ viewport: { width: 360, height: 900 }, locale: 'pl-PL' });
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('#origin').fill('Londyn');
  await page.locator('#destination').fill('Paryż');
  await page.locator('#departureDate').fill(futureDate(7));
  await page.locator('#returnDate').fill(futureDate(8));
  await page.getByRole('button', { name: /Znajdź połączenia/ }).click();
  await page.getByRole('heading', { name: 'Twój plan zwiedzania' }).waitFor();
  await page.getByLabel('Budżet na wstępy (zł)').fill('0');
  await page.getByRole('button', { name: 'Zaproponuj atrakcje' }).click();
  await page.getByText('Propozycje z katalogu', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Dodaj do planu: Jardin des Tuileries' }).click();
  await page.locator('.schedule').getByRole('heading', { name: 'Jardin des Tuileries' }).waitFor();
  await page.getByRole('button', { name: /Zapisz plan/ }).click();
  await page.waitForURL(/\/plans\/[^/]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const shareUrl = await page.getByLabel('Link tylko do odczytu', { exact: true }).inputValue();
  assert.equal(new URL(shareUrl).origin, origin, 'The share link must use the configured public port.');
  const ownerToken = await page.evaluate((planId) => localStorage.getItem(`city-break-owner:${planId}`), id);
  assert.ok(ownerToken);
  const owner = await request('GET', `/plans/${id}`, undefined, ownerToken);
  assert.equal(owner.status, 200);
  const saved = await owner.json();
  assert.deepEqual(saved.items.map((item) => item.attractionId), ['tuileries']);
  const shareToken = new URL(shareUrl).pathname.split('/').at(-1);
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(shareUrl);
  await publicPage.getByText('Tylko do odczytu', { exact: true }).waitFor();
  assert.equal(await publicPage.getByRole('button').count(), 0);
  await page.reload();
  await page.getByRole('heading', { name: 'Twój plan zwiedzania' }).waitFor();
  assert.equal((await request('DELETE', `/plans/${id}`, undefined, shareToken)).status, 403);

  await command(['stop', 'backend']);
  assert.ok([502, 503, 504].includes((await request('GET', `/shared-plans/${shareToken}`)).status));
  const logOutput = await command(['logs', '--no-color']);
  const logs = logOutput.stdout + logOutput.stderr;
  assert.ok(!logs.includes(ownerToken) && !logs.includes(shareToken), 'Request tokens must not appear in container logs.');
  await command(['up', '--no-build', '--detach', '--wait', '--wait-timeout', '180', '--force-recreate', 'backend']);
  await healthy();
  assert.equal((await request('GET', `/plans/${id}`, undefined, ownerToken)).status, 200);
  await command(['down']);
  await command(['up', '--no-build', '--detach', '--wait', '--wait-timeout', '180']);
  await healthy();
  const restored = await request('GET', `/plans/${id}`, undefined, ownerToken);
  assert.equal(restored.status, 200);
  assert.deepEqual((await restored.json()).items, saved.items);
  await publicPage.reload();
  await publicPage.getByText('Tylko do odczytu', { exact: true }).waitFor();
  assert.equal((await request('DELETE', `/plans/${id}`, undefined, ownerToken)).status, 204);
  assert.equal((await request('GET', `/shared-plans/${shareToken}`)).status, 404);
  await fs.mkdir(path.join(root, 'e2e', 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(root, 'e2e', 'artifacts', 'docker-report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), dataMode: 'demo',
    environment: { docker: versions[0].stdout.trim(), compose: versions[1].stdout.trim(), architecture: process.arch },
    checks: ['fresh image build from source', 'fresh SQLite volume and same-origin API', 'non-root processes', 'backend not published', 'API errors remain JSON',
      'browser search, catalog fallback and attraction saved', 'SPA owner and public routes', 'correct share URL with custom port', 'public token cannot delete',
      'no request tokens in logs after proxy outage', 'proxy recovery after backend recreation', 'SQLite persistence after compose down/up', 'owner deletion revokes link'] }, null, 2));
  console.log('PASS Docker: source builds, frontend/API/SQLite, browser CRUD, private/public routing, non-root, safe logs, proxy recovery and persistent volume.');
} finally { await cleanup(); }
