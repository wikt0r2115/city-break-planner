import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { apiRequest, buildApp, futureDate, launchBrowser, planInput, root, startApp, stopBuilds, stopApps } from './harness.mjs';

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
  const attraction = result.attractions.find((item) => item.openingHours.status === 'KNOWN'
    && item.entryPrices.some((price) => price.status === 'KNOWN' && price.fareType === 'STANDARD' && price.basis === 'PUBLISHED_TARIFF'));
  assert.ok(attraction, 'At least one attraction must have a refreshed tariff and recognized opening hours.');
  const priorityResults = new Map([['LOWEST_TOTAL_COST', result]]);
  const costMetric = (trip) => trip.costSummary.complete && trip.costSummary.total !== null ? Number(trip.costSummary.total) : Infinity;
  assert.ok(result.roundTripOptions.every((trip, index, all) => !index || costMetric(all[index - 1]) <= costMetric(trip)));
  for (const priority of ['SHORTEST_TRAVEL_TIME', 'FEWEST_TRANSFERS', 'MOST_TIME_AT_DESTINATION']) {
    const ranked = await apiRequest(app, 'POST', '/searches', { ...criteria, priority });
    assert.equal(ranked.status, 200);
    assert.ok(ranked.body.roundTripOptions.length > 0);
    const metric = (trip) => priority === 'SHORTEST_TRAVEL_TIME' ? trip.travelMinutes
      : priority === 'FEWEST_TRANSFERS' ? trip.transfers : -trip.timeAtDestinationMinutes;
    assert.ok(ranked.body.roundTripOptions.every((trip, index, all) => !index || metric(all[index - 1]) <= metric(trip)));
    priorityResults.set(priority, ranked.body);
  }
  const latest = priorityResults.get('MOST_TIME_AT_DESTINATION').roundTripOptions[0];
  const earlier = result.roundTripOptions.filter((trip) => Date.parse(trip.returnJourney.departureAt) < Date.parse(latest.returnJourney.departureAt))
    .sort((a, b) => Date.parse(a.returnJourney.departureAt) - Date.parse(b.returnJourney.departureAt))[0];
  assert.ok(earlier, 'The verified local timetable must offer an earlier return for this acceptance scenario.');
  const opening = attraction.openingHours.intervals.find((interval) => interval.opensAt.startsWith(date));
  assert.ok(opening);
  const lateVisit = new Date(Math.max(Date.parse(opening.opensAt), Date.parse(earlier.returnJourney.departureAt))).toISOString();
  const visitEnd = Date.parse(lateVisit) + attraction.visitMinutes * 60000;
  assert.ok(Date.parse(lateVisit) >= Date.parse(latest.outbound.arrivalAt));
  assert.ok(visitEnd <= Date.parse(opening.closesAt) && visitEnd <= Date.parse(latest.returnJourney.departureAt), 'The visit must fit opening hours and the original return before shortening the trip.');
  const draft = await apiRequest(app, 'POST', '/plans/preview', { criteria, selectedRoundTrip: latest,
    items: [{ id: 'live-acceptance-item', attractionId: attraction.id, startsAt: lateVisit, visitMinutes: attraction.visitMinutes }] });
  assert.equal(draft.status, 200);
  assert.ok(draft.body.items.every((item) => item.conflicts.every((conflict) => !['RETURN_DEPARTURE', 'OPENING_HOURS'].includes(conflict.code))));
  const changed = await apiRequest(app, 'POST', '/plans/preview', { ...planInput(draft.body), selectedRoundTrip: earlier });
  assert.equal(changed.status, 200);
  const selectedItems = (plan) => plan.items.map(({ id, attractionId, startsAt, endsAt }) => ({ id, attractionId, startsAt, endsAt }));
  assert.deepEqual(selectedItems(changed.body), selectedItems(draft.body));
  assert.ok(changed.body.items[0].conflicts.some((conflict) => conflict.code === 'RETURN_DEPARTURE'));
  assert.ok(changed.body.items[0].conflicts.some((conflict) => conflict.code === 'MISSING_DATA'), 'Unknown walking time must remain visible rather than becoming zero.');
  const created = await apiRequest(app, 'POST', '/plans', planInput(changed.body));
  assert.equal(created.status, 201);
  const savedPlan = created.body.plan;
  const ownerToken = created.body.ownerToken;
  await app.restartBackend('live');
  const persisted = await apiRequest(app, 'GET', `/plans/${savedPlan.id}`, undefined, ownerToken);
  assert.equal(persisted.status, 200);
  assert.deepEqual(persisted.body.items, savedPlan.items);
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 360, height: 900 }, locale: 'pl-PL' });
  const page = await context.newPage();
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Uzupełnij przykładową trasę' }).click();
  assert.equal(await page.locator('#origin').inputValue(), criteria.origin);
  assert.equal(await page.locator('#destination').inputValue(), criteria.destination);
  assert.equal(await page.locator('#departureDate').inputValue(), futureDate(1));
  assert.equal(await page.locator('#returnDate').inputValue(), futureDate(1));
  await page.locator('#departureDate').fill(date);
  await page.locator('#returnDate').fill(date);
  await page.getByRole('button', { name: /Znajdź połączenia/ }).click();
  await page.locator('.trip-card').first().waitFor();
  assert.equal(await page.locator('.test-banner').count(), 0);
  assert.equal(await page.locator('.trip-card').count(), Math.min(2, result.roundTripOptions.length));
  await page.locator('.trip-card').getByText('Normalna:', { exact: false }).first().waitFor();
  assert.equal(await page.locator('.trip-card').getByText(/Taryfa publikowana|Sprawdzono:|Źródło ceny/i).count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await context.close();
  const publicContext = await browser.newContext({ viewport: { width: 360, height: 900 }, locale: 'pl-PL' });
  const publicPage = await publicContext.newPage();
  await publicPage.goto(savedPlan.shareUrl);
  await publicPage.getByText('Tylko do odczytu', { exact: true }).waitFor();
  assert.equal(await publicPage.getByRole('button').count(), 0);
  assert.equal(await publicPage.locator('.test-banner').count(), 0);
  await publicPage.locator('.conflicts').first().waitFor();
  assert.ok(!(await publicPage.locator('body').innerText()).includes(ownerToken));
  await publicContext.close();
  assert.equal((await apiRequest(app, 'DELETE', `/plans/${savedPlan.id}`, undefined, ownerToken)).status, 204);

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
    attractions: result.attractions,
    acceptance: { priorities: [...priorityResults.keys()], earlierReturnPreservedItems: true, missingWalkingTimeVisible: true,
      actualBackendRestart: true, savedPublicReadOnly: true },
    coverageProbe: { date: outside, status: coverage.body.status, sources: coverage.body.sources },
    limits: 'Published tariffs are not a dated booking quote. This validates only the approved local Gdańsk stage, not rail/flights/coaches or the full future product scope.' }, null, 2));
  failed = false;
  console.log(`PASS live: approved Gdańsk local route on ${date}, ${result.roundTripOptions.length} dated round trips, published tariffs, mobile UI and explicit outside-coverage response. Report: e2e/artifacts/live-report.json.`);
} catch (error) {
  if (app) console.error(`Live verification failed; inspect ${app.directory}. A failed external source is not a verified absence of service.`);
  throw error;
} finally { await cleanup(); }
