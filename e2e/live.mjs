import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { apiRequest, buildApp, launchBrowser, root, startApp, stopBuilds, stopApps } from './harness.mjs';

const date = process.env.E2E_LIVE_DATE;
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
  throw new Error('Set E2E_LIVE_DATE=YYYY-MM-DD to an explicitly chosen date inside the published Gdańsk timetable. This live check is opt-in.');
let app;
let browser;
let failed = true;
const cleanup = async () => { try { await browser?.close(); } finally { await stopBuilds(); await stopApps({ keep: failed }); } };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });

try {
  await buildApp();
  app = await startApp({ mode: 'live' });
  const criteria = { origin: 'Dworzec Główny', destination: 'Targ Rybny', departureDate: date, returnDate: date,
    priority: 'LOWEST_TOTAL_COST', currency: 'PLN', fareType: 'STANDARD' };
  const response = await apiRequest(app, 'POST', '/searches', criteria);
  assert.equal(response.status, 200);
  const result = response.body;
  assert.equal(result.testData, false);
  assert.ok(result.roundTripOptions.length > 0, 'No actual dated round trip was returned; do not count a provider failure as a successful live verification.');
  const prices = [];
  for (const trip of result.roundTripOptions) {
    for (const journey of [trip.outbound, trip.returnJourney]) {
      assert.ok(!journey.departureAt.includes('1899'));
      assert.ok(journey.departureAt.startsWith(date));
      assert.ok(Date.parse(journey.arrivalAt) >= Date.parse(journey.departureAt));
      for (const segment of journey.segments) {
        assert.equal(segment.mode, 'LOCAL_TRANSIT');
        for (const price of segment.prices) {
          if (price.status !== 'KNOWN') continue;
          assert.equal(price.basis, 'PUBLISHED_TARIFF');
          assert.equal(price.currency, 'PLN');
          assert.ok(Number.isFinite(Number(price.amount)) && Number(price.amount) >= 0);
          assert.ok(price.sourceUrl && !Number.isNaN(Date.parse(price.checkedAt)));
          assert.ok(price.testData !== true);
          if (price.fareType === 'REDUCED') assert.ok(price.eligibility?.trim());
          prices.push({ amount: price.amount, currency: price.currency, fareType: price.fareType,
            basis: price.basis, sourceUrl: price.sourceUrl, checkedAt: price.checkedAt, eligibility: price.eligibility });
        }
      }
    }
  }
  assert.ok(prices.length > 0, 'A live timetable alone does not verify tariff access.');
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 360, height: 900 }, locale: 'pl-PL' });
  const page = await context.newPage();
  await page.goto(app.url);
  await page.locator('#origin').fill(criteria.origin);
  await page.locator('#destination').fill(criteria.destination);
  await page.locator('#departureDate').fill(date);
  await page.locator('#returnDate').fill(date);
  await page.getByRole('button', { name: /Znajdź połączenia/ }).click();
  await page.locator('.trip-card').first().waitFor();
  assert.equal(await page.locator('.test-banner').count(), 0);
  await page.getByText(/Taryfa publikowana/i).first().waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await context.close();

  const distant = new Date(`${date}T12:00:00Z`);
  distant.setUTCDate(distant.getUTCDate() + 400);
  const outside = distant.toISOString().slice(0, 10);
  const coverage = await apiRequest(app, 'POST', '/searches', { ...criteria, departureDate: outside, returnDate: outside });
  assert.equal(coverage.status, 200);
  assert.deepEqual(coverage.body.roundTripOptions, []);
  assert.notEqual(coverage.body.status, 'NO_CONNECTION');
  assert.ok(coverage.body.sources.some((source) => source.status === 'NO_COVERAGE'), 'Outside published coverage must be explicit, not a claim that no service exists.');

  const artifacts = path.join(root, 'e2e', 'artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  await fs.writeFile(path.join(artifacts, 'live-report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), dataMode: 'live', criteria,
    status: result.status, optionCount: result.roundTripOptions.length, sources: result.sources,
    firstRoundTrip: { outbound: result.roundTripOptions[0].outbound, returnJourney: result.roundTripOptions[0].returnJourney },
    publishedTariffs: [...new Map(prices.map((price) => [JSON.stringify(price), price])).values()],
    coverageProbe: { date: outside, status: coverage.body.status, sources: coverage.body.sources },
    limits: 'Published tariffs are not a dated booking quote. This validates only the approved local Gdańsk stage, not rail/flights/coaches or the full future product scope.' }, null, 2));
  failed = false;
  console.log(`PASS live: approved Gdańsk local route on ${date}, ${result.roundTripOptions.length} dated round trips, published tariffs, mobile UI and explicit outside-coverage response. Report: e2e/artifacts/live-report.json.`);
} catch (error) {
  if (app) console.error(`Live verification failed; inspect ${app.directory}. A failed external source is not a verified absence of service.`);
  throw error;
} finally { await cleanup(); }
