#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.includes('--help')) {
  console.log('Record the explicitly fictional planner demo as docs/media/demo.gif.\nPrerequisites: built backend JAR, frontend npm ci, Playwright, Python with Pillow.\nOptional environment: CHROME_EXECUTABLE, PLAYWRIGHT_MODULE, PYTHON, RECORD_BACKEND_JAR, RECORD_FRONTEND_DIR, RECORD_OUTPUT.\nOnly newly spawned processes and a private temporary database are used.');
  process.exit(0);
}

const frontend = path.resolve(process.env.RECORD_FRONTEND_DIR || path.join(root, 'frontend'));
const jar = path.resolve(process.env.RECORD_BACKEND_JAR || path.join(root, 'backend/target/city-break-planner-0.0.1-SNAPSHOT.jar'));
const output = path.resolve(process.env.RECORD_OUTPUT || path.join(root, 'docs/media/demo.gif'));
if (!output.toLowerCase().endsWith('.gif')) throw new Error('RECORD_OUTPUT must end with .gif');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const vite = path.join(frontend, 'node_modules/vite/bin/vite.js');
await fs.access(jar).catch(() => { throw new Error('Build the backend first: cd backend && ./mvnw package'); });
await fs.access(vite).catch(() => { throw new Error('Install frontend dependencies first: cd frontend && npm ci'); });
await exec(python, ['-c', 'from PIL import Image; print(Image.__version__)']);

let playwright;
try {
  let module = process.env.PLAYWRIGHT_MODULE || path.join(root, 'e2e/node_modules/playwright/index.mjs');
  if ((await fs.stat(module)).isDirectory()) module = path.join(module, 'index.mjs');
  playwright = await import(pathToFileURL(path.resolve(module)).href);
} catch {
  try { playwright = await import('playwright'); }
  catch { throw new Error('Install e2e dependencies with npm ci in e2e/, or set PLAYWRIGHT_MODULE to an installed Playwright package.'); }
}

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'city-break-recording-'));
const children = [];
const handles = [];
const pendingLaunches = new Set();
let stopping = false;
let browser;
let browserPromise;
let temporaryOutput;
let cleanupPromise;
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function cleanup() {
  stopping = true;
  return cleanupPromise ||= (async () => {
    await Promise.allSettled([...pendingLaunches]);
    const activeBrowser = browser || await browserPromise?.catch(() => undefined);
    await activeBrowser?.close().catch(() => {});
    await Promise.allSettled(children.map(stop));
    await Promise.allSettled(handles.map((handle) => handle.close()));
    await fs.rm(work, { recursive: true, force: true });
    if (temporaryOutput) await fs.rm(temporaryOutput, { force: true });
  })();
}
function ensureRunning() {
  if (stopping) throw new Error('Recording was stopped.');
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(code)); });
}
async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}
function launch(command, args, cwd, env, label) {
  ensureRunning();
  const operation = (async () => {
    const log = await fs.open(path.join(work, `${label}.log`), 'a', 0o600);
    if (stopping) {
      await log.close();
      ensureRunning();
    }
    handles.push(log);
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
    child.spawnError = undefined;
    child.once('error', (error) => { child.spawnError = error; });
    children.push(child);
    return child;
  })();
  pendingLaunches.add(operation);
  operation.then(() => pendingLaunches.delete(operation), () => pendingLaunches.delete(operation));
  return operation;
}
function runOwned(command, args) {
  ensureRunning();
  const operation = exec(command, args);
  children.push(operation.child);
  return operation;
}
async function ready(url, child) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    ensureRunning();
    if (child.spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error('Recording server could not start. Check the backend build and free local ports.');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await pause(100);
  }
  throw new Error('Recording server did not become ready within 45 seconds.');
}
async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  await Promise.race([stopped, pause(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([stopped, pause(1000)]);
  }
}
function dateAfter(days) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86400000));
}
async function caption(page, text) {
  await page.evaluate((label) => {
    let bar = document.getElementById('recording-caption');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'recording-caption'; document.body.append(bar);
      Object.assign(bar.style, { position: 'fixed', inset: '0 0 auto 0', zIndex: '2147483647', background: '#fff1ba', color: '#392a08', padding: '13px 22px', font: '700 17px/1.4 system-ui,sans-serif', boxShadow: '0 2px 10px #0002', pointerEvents: 'none' });
      document.body.style.paddingTop = '52px';
    }
    bar.textContent = `${label} · DANE TESTOWE — fikcyjne ceny i połączenia`;
  }, text);
}

try {
  const backendPort = await unusedPort();
  let frontendPort = await unusedPort();
  while (frontendPort === backendPort) frontendPort = await unusedPort();
  const origin = `http://127.0.0.1:${frontendPort}`;
  const api = `http://127.0.0.1:${backendPort}/api/v1`;
  const backend = await launch(java, ['-jar', jar], root, {
    APP_DATA_MODE: 'demo', SERVER_ADDRESS: '127.0.0.1', SERVER_PORT: String(backendPort),
    SPRING_DATASOURCE_URL: `jdbc:sqlite:${path.join(work, 'plans.db')}`,
    APP_CORS_ALLOWED_ORIGINS: origin, APP_FRONTEND_BASE_URL: origin,
  }, 'backend');
  const web = await launch(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], frontend, { VITE_API_BASE_URL: api }, 'frontend');
  await Promise.all([ready(`${api}/health`, backend), ready(origin, web)]);
  let executablePath = process.env.CHROME_EXECUTABLE;
  if (!executablePath) {
    for (const candidate of ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']) {
      if (await fs.access(candidate).then(() => true, () => false)) { executablePath = candidate; break; }
    }
  }
  ensureRunning();
  browserPromise = playwright.chromium.launch({ headless: true, timeout: 15000,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    ...(executablePath ? { executablePath } : {}),
    ...(process.env.CHROME_NO_SANDBOX === '1' ? { args: ['--no-sandbox'] } : {}) });
  browser = await browserPromise;
  const context = await browser.newContext({ viewport: { width: 1240, height: 800 }, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const frames = [];
  async function frame(label, duration) {
    await caption(page, label);
    await pause(150);
    const filename = path.join(work, `frame-${frames.length}.png`);
    await page.screenshot({ path: filename });
    frames.push({ filename, label, duration });
  }

  await page.goto(origin);
  await page.locator('#origin').fill('Warszawa');
  await page.locator('#destination').fill('Gdańsk');
  await page.locator('#departureDate').fill(dateAfter(7));
  await page.locator('#returnDate').fill(dateAfter(8));
  await frame('1 / Wyszukiwanie podróży', 1600);
  const search = page.waitForResponse((response) => response.url().endsWith('/searches') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Znajdź połączenia/ }).click();
  assert.equal((await (await search).json()).testData, true, 'Refusing to record fictional fixtures without their explicit API label');
  await page.getByRole('heading', { name: 'Twój plan zwiedzania' }).waitFor();
  await page.locator('.test-banner').waitFor();
  assert.equal(await page.locator('.schedule > li').count(), 3);
  await page.getByRole('heading', { name: 'Warszawa → Gdańsk', exact: true }).evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -75));
  await frame('2 / Wyniki i alternatywne powroty', 2000);

  const names = await page.locator('.schedule > li h4').allTextContents();
  const early = page.locator('.trip-card').filter({ has: page.getByRole('heading', { name: /Powrót:.*14:00/ }) });
  await early.getByRole('button', { name: 'Wybierz połączenie', exact: true }).click();
  await page.locator('.conflicts').first().waitFor();
  assert.deepEqual(await page.locator('.schedule > li h4').allTextContents(), names);
  await early.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -75));
  await frame('3 / Wybrano wcześniejszy powrót: 14:00', 1800);
  await page.locator('.conflicts').first().evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await frame('4 / Konflikt ma powód; wybrane miejsca zostają', 2600);

  await page.getByRole('button', { name: /Zapisz plan/ }).click();
  await page.waitForURL(/\/plans\/[^/]+$/);
  const share = await page.getByLabel('Link tylko do odczytu', { exact: true }).inputValue();
  await page.getByRole('heading', { name: 'Dobry plan warto zachować.', exact: true }).evaluate((element) => element.closest('section').scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -75));
  await frame('5 / Zapis i niezależny link do odczytu', 2200);

  const publicContext = await browser.newContext({ viewport: { width: 1240, height: 800 }, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
  const publicPage = await publicContext.newPage();
  await publicPage.goto(share);
  await publicPage.getByText('Tylko do odczytu', { exact: true }).waitFor();
  await publicPage.locator('.test-banner').waitFor();
  assert.equal(await publicPage.getByRole('button').count(), 0);
  await caption(publicPage, '6 / Odbiorca ogląda plan bez prawa edycji');
  const publicFrame = path.join(work, `frame-${frames.length}.png`);
  await publicPage.screenshot({ path: publicFrame });
  frames.push({ filename: publicFrame, label: '6 / Odbiorca ogląda plan bez prawa edycji', duration: 2400 });
  await publicPage.getByRole('heading', { name: 'Plan zwiedzania', exact: true }).evaluate((element) => element.closest('section').scrollIntoView({ block: 'start' }));
  await publicPage.evaluate(() => window.scrollBy(0, -75));
  await caption(publicPage, '7 / Publiczny harmonogram zachowuje ostrzeżenia');
  const publicSchedule = path.join(work, `frame-${frames.length}.png`);
  await publicPage.screenshot({ path: publicSchedule });
  frames.push({ filename: publicSchedule, label: '7 / Publiczny harmonogram zachowuje ostrzeżenia', duration: 2400 });
  assert.deepEqual(errors, []);
  await publicContext.close();
  await context.close();

  await fs.mkdir(path.dirname(output), { recursive: true });
  temporaryOutput = path.join(path.dirname(output), `.recording-${process.pid}.gif`);
  const manifest = path.join(work, 'frames.json');
  await fs.writeFile(manifest, JSON.stringify(frames));
  const encoded = await runOwned(python, [path.join(root, 'scripts/lib/recording/encode-gif.py'), manifest, temporaryOutput]);
  const properties = JSON.parse(encoded.stdout);
  const playbackContext = await browser.newContext({ viewport: { width: 1260, height: 820 } });
  const playback = await playbackContext.newPage();
  await playback.goto(pathToFileURL(temporaryOutput).href);
  await playback.locator('img').waitFor();
  assert.equal(await playback.locator('img').evaluate((image) => image.naturalWidth), properties.width);
  const firstFrame = createHash('sha256').update(await playback.screenshot()).digest('hex');
  let advanced = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    await pause(200);
    if (createHash('sha256').update(await playback.screenshot()).digest('hex') !== firstFrame) { advanced = true; break; }
  }
  assert.ok(advanced, 'The browser must actually advance the animated GIF');
  await playbackContext.close();
  ensureRunning();
  await fs.rename(temporaryOutput, output);
  temporaryOutput = undefined;
  const revision = await runOwned('git', ['-C', frontend, 'rev-parse', 'HEAD']).then((result) => result.stdout.trim(), () => 'unknown');
  const metadata = {
    recordedAt: new Date().toISOString(), mode: 'demo', testData: true,
    purpose: 'Technical workflow only. Fictional fares and schedules; not proof of live route availability.',
    sourceRevision: revision, browserPlaybackVerified: true,
    sha256: createHash('sha256').update(await fs.readFile(output)).digest('hex'),
    ...properties, steps: frames.map(({ label, duration }) => ({ label, durationMs: duration })),
  };
  await fs.writeFile(output.replace(/\.gif$/i, '') + '.json', JSON.stringify(metadata, null, 2) + '\n');
  console.log(`Recorded and decoded ${properties.frames} frames, ${properties.durationMs / 1000}s, ${properties.bytes} bytes: ${path.relative(root, output)}`);
} finally {
  await cleanup();
}
