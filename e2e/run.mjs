import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { apiRequest, buildApp, futureDate, launchBrowser, planInput, root, startApp, stopBuilds, stopApps } from './harness.mjs';

const checks = [];
let app;
let browser;
let page;
let failed = true;
const check = async (name, action) => { const start = Date.now(); await action(); checks.push({ name, passed: true, milliseconds: Date.now() - start }); console.log(`PASS demo: ${name}`); };
const artifacts = path.join(root, 'e2e', 'artifacts');
await fs.mkdir(artifacts, { recursive: true });
const cleanup = async () => { try { await browser?.close(); } finally { await stopBuilds(); await stopApps({ keep: failed }); } };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });

try {
  await buildApp();
  app = await startApp({ controlledFaults: true });
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
  page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const criteria = { origin: 'Warszawa', destination: 'Gdańsk', departureDate: futureDate(7), returnDate: futureDate(8), priority: 'LOWEST_TOTAL_COST', currency: 'PLN', fareType: 'STANDARD' };
  const preview = () => page.waitForResponse((response) => response.url().endsWith('/plans/preview') && response.request().method() === 'POST');
  const idle = () => page.waitForFunction(() => !document.querySelector('fieldset.unframed')?.disabled);
  const names = () => page.locator('.schedule > li h4').allTextContents();
  let saved;
  let shareUrl;
  let ownerToken;
  let expectedNames;

  await check('keyboard search, actual HTTP/CORS and explicit test-data labels', async () => {
    await page.goto(app.url);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').textContent(), 'Przejdź do treści');
    await page.locator('#origin').focus();
    await page.keyboard.type(criteria.origin);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'destination');
    await page.keyboard.type(criteria.destination);
    await page.getByLabel('Data wyjazdu', { exact: true }).fill(criteria.departureDate);
    await page.getByLabel('Data powrotu', { exact: true }).fill(criteria.returnDate);
    await page.getByRole('button', { name: /Znajdź połączenia/ }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Twój plan zwiedzania' }).waitFor();
    await idle();
    assert.equal(await page.locator('.trip-card').count(), 3);
    assert.equal(await page.locator('.schedule > li').count(), 3);
    await page.locator('.test-banner').waitFor();
    assert.ok(await page.getByText(/Ulgowa:/).count());
    assert.equal(await page.locator('.source-notes').count(), 0);
    assert.equal(await page.locator('.trip-card').getByText(/Sprawdzono:|Warunki ulgi:|Źródło ceny/).count(), 0);
    const next = page.getByRole('button', { name: 'Następna' });
    const previous = page.getByRole('button', { name: 'Poprzednia' });
    assert.ok(await previous.isDisabled());
    await next.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByText('Strona 2 z 2', { exact: true }).count(), 1);
    assert.ok(await next.isDisabled());
    assert.ok(await page.getByText('Łączny koszt niepotwierdzony', { exact: true }).count());
    await previous.click();
    assert.equal(await page.getByRole('button', { name: /^Wariant 1,/ }).getAttribute('aria-pressed'), 'true');
    const links = await page.locator('.inline-links a').evaluateAll((elements) => elements.map((element) => ({ href: element.href, rel: element.rel, policy: element.referrerPolicy })));
    assert.ok(links.length);
    assert.ok(links.every((link) => /^https?:/.test(link.href) && link.rel.includes('noreferrer') && link.policy === 'no-referrer'));
  });

  await check('all four server priorities and incomplete costs', async () => {
    for (const [priority, first] of [['LOWEST_TOTAL_COST', 'demo-budget'], ['SHORTEST_TRAVEL_TIME', 'demo-fast'], ['FEWEST_TRANSFERS', 'demo-direct'], ['MOST_TIME_AT_DESTINATION', 'demo-long']]) {
      const response = await apiRequest(app, 'POST', '/searches', { ...criteria, priority });
      assert.equal(response.status, 200);
      assert.equal(response.body.testData, true);
      assert.equal(response.body.roundTripOptions[0].id, first);
      assert.ok(response.body.roundTripOptions.some((trip) => !trip.costSummary.complete && trip.costSummary.total === null));
    }
  });

  await check('earlier return keeps selected points and explains conflicts', async () => {
    const original = await names();
    const early = page.getByRole('button', { name: /^Wariant .*powrót.*14:00/i });
    const next = page.getByRole('button', { name: 'Następna' });
    while (!await early.count() && await next.isEnabled()) await next.click();
    const earlyCard = page.locator('.trip-card').filter({ has: early });
    for (const link of await earlyCard.getByRole('link').all()) {
      await link.evaluate((element) => element.addEventListener('click', (event) => event.preventDefault(), { once: true }));
      await link.click();
      assert.equal(await early.getAttribute('aria-pressed'), 'false');
      await link.evaluate((element) => element.addEventListener('click', (event) => event.preventDefault(), { once: true }));
      await link.press('Enter');
      assert.equal(await early.getAttribute('aria-pressed'), 'false');
    }
    await Promise.all([preview(), early.press('Enter')]);
    await idle();
    await page.locator('.conflicts').first().waitFor();
    assert.deepEqual(await names(), original);
    assert.ok((await page.locator('.conflicts').allTextContents()).some((reason) => reason.includes('odjeździe powrotnym')));
  });

  await check('add, remove and reorder attraction through real preview API', async () => {
    await Promise.all([preview(), page.getByRole('button', { name: 'Usuń Park — dane testowe', exact: true }).click()]);
    await page.waitForFunction(() => document.querySelectorAll('.schedule > li').length === 2);
    await idle();
    await Promise.all([preview(), page.getByRole('button', { name: 'Dodaj: Park — dane testowe', exact: true }).click()]);
    await page.waitForFunction(() => document.querySelectorAll('.schedule > li').length === 3);
    await idle();
    await Promise.all([preview(), page.getByRole('button', { name: 'Przesuń Park — dane testowe wcześniej', exact: true }).click()]);
    await page.waitForFunction(() => [...document.querySelectorAll('.schedule > li h4')][1]?.textContent === 'Park — dane testowe');
    await idle();
    expectedNames = await names();
  });

  await check('create, update and owner credential separation', async () => {
    await page.getByRole('button', { name: /Zapisz plan/ }).click();
    await page.waitForURL(/\/plans\/[^/]+$/);
    await idle();
    const id = new URL(page.url()).pathname.split('/').at(-1);
    ownerToken = await page.evaluate((planId) => localStorage.getItem(`city-break-owner:${planId}`), id);
    assert.ok(ownerToken);
    assert.ok(!page.url().includes(ownerToken));
    assert.ok(!(await page.locator('body').innerText()).includes(ownerToken));
    shareUrl = await page.getByLabel('Link tylko do odczytu', { exact: true }).inputValue();
    assert.equal(new URL(shareUrl).origin, app.url);
    const previous = page.getByRole('button', { name: 'Poprzednia' });
    while (await previous.isEnabled()) await previous.click();
    const budget = page.getByRole('button', { name: /^Wariant 1,/ });
    await Promise.all([preview(), budget.click({ position: { x: 12, y: 12 } })]);
    await idle();
    const update = page.waitForResponse((response) => response.url().endsWith(`/plans/${id}`) && response.request().method() === 'PUT');
    await page.getByRole('button', { name: /Zapisz zmiany/ }).click();
    assert.equal((await update).status(), 200);
    await idle();
    const response = await apiRequest(app, 'GET', `/plans/${id}`, undefined, ownerToken);
    assert.equal(response.status, 200);
    saved = response.body;
    assert.deepEqual(saved.items.map((item) => item.name), expectedNames);
  });

  await check('API rejects missing, public and another-owner edit credentials', async () => {
    const token = new URL(shareUrl).pathname.split('/').at(-1);
    assert.equal((await apiRequest(app, 'GET', `/plans/${saved.id}`)).status, 401);
    assert.equal((await apiRequest(app, 'PUT', `/plans/${saved.id}`, planInput(saved), token)).status, 403);
    assert.equal((await apiRequest(app, 'DELETE', `/plans/${saved.id}`, undefined, token)).status, 403);
    assert.equal((await apiRequest(app, 'PUT', `/shared-plans/${token}`, planInput(saved))).status, 405);
    assert.equal((await apiRequest(app, 'DELETE', `/shared-plans/${token}`)).status, 405);
    const other = await apiRequest(app, 'POST', '/plans', planInput(saved));
    assert.equal(other.status, 201);
    assert.equal((await apiRequest(app, 'GET', `/plans/${saved.id}`, undefined, other.body.ownerToken)).status, 403);
    assert.equal((await apiRequest(app, 'DELETE', `/plans/${other.body.plan.id}`, undefined, other.body.ownerToken)).status, 204);
  });

  await check('independent public session, no edit UI and mobile layout', async () => {
    await page.setViewportSize({ width: 360, height: 900 });
    await page.getByText('Strona 1 z 3', { exact: true }).waitFor();
    assert.equal(await page.locator('.trip-card').count(), 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const publicContext = await browser.newContext({ viewport: { width: 360, height: 900 } });
    try {
      const publicPage = await publicContext.newPage();
      let authorization;
      publicPage.on('request', (request) => { if (request.url().includes('/shared-plans/')) authorization = request.headers().authorization; });
      await publicPage.goto(shareUrl);
      await publicPage.getByText('Tylko do odczytu', { exact: true }).waitFor();
      assert.equal(await publicPage.getByRole('button').count(), 0);
      assert.equal(authorization, undefined);
      assert.ok(!(await publicPage.locator('body').innerText()).includes(ownerToken));
      await publicPage.locator('.test-banner').waitFor();
      assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert.equal(await publicPage.locator('meta[name=referrer]').getAttribute('content'), 'no-referrer');
    } finally { await publicContext.close(); }
  });

  await check('actual backend process restart keeps plan and public link', async () => {
    await app.restartBackend('demo');
    await page.reload();
    await page.getByRole('heading', { name: 'Twój plan zwiedzania' }).waitFor();
    await idle();
    assert.deepEqual(await names(), expectedNames);
    assert.equal(await page.getByLabel('Link tylko do odczytu', { exact: true }).inputValue(), shareUrl);
    const token = new URL(shareUrl).pathname.split('/').at(-1);
    const publicPlan = await apiRequest(app, 'GET', `/shared-plans/${token}`);
    assert.equal(publicPlan.status, 200);
    assert.equal(publicPlan.body.testData, true);
    assert.ok(!('ownerToken' in publicPlan.body));
    assert.ok(!('shareUrl' in publicPlan.body));
  });

  await check('controlled HTTP no-course/source-error responses preserve editor', async () => {
    // Explicit negative UI scenarios from a test-only HTTP proxy, not operator data.
    for (const status of ['NO_CONNECTION', 'PROVIDER_ERROR']) {
      app.setSearchFault(status);
      await page.getByLabel('Data powrotu', { exact: true }).fill(futureDate(9));
      await page.getByRole('button', { name: /Znajdź połączenia/ }).click();
      await page.getByRole('alert').filter({ hasText: 'Poprzedni plan, wybrane punkty i uprawnienia zostały zachowane.' }).waitFor();
      await idle();
      assert.deepEqual(await names(), expectedNames);
      assert.equal(await page.getByLabel('Link tylko do odczytu', { exact: true }).inputValue(), shareUrl);
      assert.equal(await page.getByRole('button', { name: 'Usuń zapisany plan', exact: true }).count(), 1);
    }
    app.setSearchFault(null);
  });

  await check('deletion revokes previously working public link', async () => {
    assert.equal((await apiRequest(app, 'DELETE', `/plans/${saved.id}`, undefined, ownerToken)).status, 204);
    const publicPage = await context.newPage();
    try {
      await publicPage.goto(shareUrl);
      await publicPage.getByRole('alert').waitFor();
      assert.match(await publicPage.getByRole('alert').textContent(), /nie znaleziono|nie istnieje|utracił ważność/i);
      assert.equal((await apiRequest(app, 'GET', `/shared-plans/${new URL(shareUrl).pathname.split('/').at(-1)}`)).status, 404);
    } finally { await publicPage.close(); }
    assert.deepEqual(browserErrors, []);
  });
  await context.close();
  failed = false;
  await fs.writeFile(path.join(artifacts, 'demo-report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), dataMode: 'demo', route: `${criteria.origin} → ${criteria.destination}`, dates: [criteria.departureDate, criteria.returnDate], controlledNegativeHttpScenarios: true, checks }, null, 2));
  console.log(`PASS: ${checks.length} demo acceptance groups. Report: e2e/artifacts/demo-report.json. These are not live offers.`);
} catch (error) {
  try { await page?.screenshot({ path: path.join(artifacts, 'failure.png') }); } catch {}
  if (app) console.error(`Failure diagnostics retained in ${app.directory}; no credentials are printed.`);
  throw error;
} finally { await cleanup(); }
