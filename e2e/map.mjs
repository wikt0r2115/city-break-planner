import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Exercise the real renderer with a controlled empty basemap: no paid traffic,
// no real MapTiler key, and no dependence on external tile availability.
process.env.VITE_MAPTILER_API_KEY = 'map-integration-test';
const { apiRequest, buildApp, futureDate, launchBrowser, startApp } = await import('./harness.mjs');
await buildApp();
const app = await startApp();
let browser;
try {
  const criteria = { origin: 'Londyn', destination: 'Paryż', departureDate: futureDate(7),
    returnDate: futureDate(9), priority: 'SHORTEST_TRAVEL_TIME', currency: 'PLN', fareType: 'STANDARD' };
  const search = await apiRequest(app, 'POST', '/searches', criteria);
  assert.equal(search.status, 200);
  const attractions = search.body.attractions.slice(0, 2);
  assert.equal(attractions.length, 2);
  const input = { criteria, selectedRoundTrip: search.body.roundTripOptions[0], items: attractions.map((item, index) => ({
    id: `map-visit-${index}`, attractionId: item.id, startsAt: null, visitMinutes: item.visitMinutes,
  })) };
  const created = await apiRequest(app, 'POST', '/plans', input);
  assert.equal(created.status, 201);
  const { plan, ownerToken } = created.body;
  assert.ok(plan.items.every((item) => item.location && Number.isFinite(item.location.latitude)));
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  const externalRequests = [];
  let rejectStyle = false;
  let styleRequests = 0;
  await context.route('https://api.maptiler.com/**', async (route) => {
    const request = route.request();
    externalRequests.push({ url: request.url(), headers: request.headers() });
    if (new URL(request.url()).pathname.endsWith('/style.json')) {
      styleRequests++;
      await route.fulfill(rejectStyle ? { status: 403, body: 'Controlled key failure' } : {
        contentType: 'application/json', body: JSON.stringify({ version: 8,
          sources: { 'test-data': { type: 'geojson', data: { type: 'FeatureCollection', features: [] },
            attribution: '<details open onload="1" ontoggle="window.__mapXss=true">bad</details><a href="javascript:window.__mapXss=true">bad</a>© test',
          } }, layers: [{ id: 'test-background', type: 'background', paint: { 'background-color': '#e9efe7' } },
            { id: 'test-points', type: 'circle', source: 'test-data' }],
        }),
      });
    } else if (new URL(request.url()).pathname === '/resources/logo.svg') {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><text x="0" y="20">Test map logo</text></svg>' });
    } else await route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.error('Browser:', message.text()); });
  await page.goto(app.url);
  await page.evaluate(({ id, token }) => localStorage.setItem(`city-break-owner:${id}`, token), { id: plan.id, token: ownerToken });
  await page.goto(`${app.url}/plans/${plan.id}`);
  await page.getByRole('heading',{name:'Twój wyjazd jest gotowy',exact:true}).waitFor();
  await page.getByRole('navigation',{name:'Etapy planowania'}).getByRole('button',{name:'Atrakcje',exact:true}).click();
  await page.getByRole('button',{name:/^Harmonogram/}).click();
  const map = page.locator('.trip-map-panel');
  await map.getByRole('button', { name: 'Zwiedzanie', exact: true }).waitFor().catch(async (error) => {
    console.error('Map state:', await map.innerText(), 'page errors:', errors,
      'provider paths:', externalRequests.map((request) => new URL(request.url).pathname));
    throw error;
  });
  assert.equal(await map.locator('canvas').count(), 1);
  assert.equal(await map.locator('.visit-marker').count(), 2);
  await map.getByLabel('MapTiler logo').waitFor();
  await map.locator('.maplibregl-ctrl-attrib-inner').filter({ hasText: '© test' }).waitFor();
  assert.equal(await page.evaluate(() => window.__mapXss === true), false);
  assert.equal(await map.locator('.maplibregl-ctrl-attrib [onload], .maplibregl-ctrl-attrib [ontoggle], .maplibregl-ctrl-attrib a[href^="javascript:"]').count(), 0);
  const initialStyles = styleRequests;
  await page.getByRole('button', { name: `Przesuń ${plan.items[1].name} wcześniej`, exact: true }).click();
  await page.waitForFunction((name) => document.querySelector('.visit-marker[aria-label^="1."]')?.getAttribute('aria-label')?.includes(name), plan.items[1].name);
  assert.equal(styleRequests, initialStyles, 'Reordering must reuse the map session.');
  await map.locator('.visit-marker').first().focus();
  await page.keyboard.press('Enter');
  await map.locator('.maplibregl-popup-content').waitFor();
  await page.getByRole('button',{name:'Dalej: Podsumowanie',exact:true}).click();
  await page.getByRole('button', { name: /Zapisz zmiany/ }).click();
  await page.getByText('Plan zapisany. Możesz udostępnić link tylko do odczytu.', { exact: true }).waitFor();
  const sharedToken = new URL(plan.shareUrl).pathname.split('/').at(-1);
  const publicPage = await context.newPage();
  await publicPage.goto(`${app.url}/shared/${sharedToken}`);
  await publicPage.locator('.trip-map-panel').getByRole('button', { name: 'Zwiedzanie', exact: true }).waitFor();
  assert.equal(await publicPage.locator('.visit-marker').count(), 2);
  assert.equal(await publicPage.getByRole('button', { name: /Zapisz|Usuń|Przesuń|Dodaj/ }).count(), 0);
  await publicPage.setViewportSize({ width: 360, height: 900 });
  assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await fs.mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
  await publicPage.locator('.trip-map-panel').screenshot({ path: new URL('./artifacts/map-mobile.png', import.meta.url).pathname });
  for (const request of externalRequests) {
    assert.ok(!request.headers.authorization);
    assert.ok(!request.headers.referer?.includes(ownerToken) && !request.headers.referer?.includes(sharedToken), 'Shared capability URL must not reach the map provider.');
    assert.ok(!request.url.includes(ownerToken) && !request.url.includes(sharedToken));
  }
  rejectStyle = true;
  const failed = await context.newPage();
  await failed.goto(`${app.url}/shared/${sharedToken}`);
  await failed.getByRole('alert').filter({ hasText: 'Nie udało się wczytać mapy' }).waitFor();
  await failed.getByRole('heading', { name: 'Plan zwiedzania', exact: true }).waitFor();
  rejectStyle = false;
  await failed.getByRole('button', { name: 'Ponów wczytanie mapy' }).click();
  await failed.locator('.trip-map-panel').getByRole('button', { name: 'Zwiedzanie', exact: true }).waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS map: real SDK/WebGL with controlled basemap, keyboard, reorder/session reuse, save/public read, mobile, provider failure/retry, no capability leakage.');
} finally {
  try { await browser?.close(); } finally { await app.stop(); }
}
