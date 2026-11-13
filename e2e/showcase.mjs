import assert from 'node:assert/strict';
import { apiRequest, buildApp, futureDate, launchBrowser, startApp } from './harness.mjs';

await buildApp();
const app = await startApp();
let browser;
try {
  const criteria = { origin: 'Londyn', destination: 'Paryż', departureDate: futureDate(2), returnDate: futureDate(4),
    priority: 'LOWEST_TOTAL_COST', currency: 'PLN', fareType: 'STANDARD' };
  async function search(override = {}) {
    const reply = await apiRequest(app, 'POST', '/searches', { ...criteria, ...override });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.testData, true);
    return reply.body.roundTripOptions;
  }
  const catalog = await apiRequest(app, 'GET', '/places');
  assert.deepEqual(catalog.body.places.map((place) => place.value), ['Amsterdam', 'Londyn', 'Paryż']);
  const budget = await search({ origin: 'London', destination: 'Paris' });
  const fast = await search({ priority: 'SHORTEST_TRAVEL_TIME' });
  assert.equal(budget[0].id, 'lp-coach');
  assert.equal(fast[0].id, 'lp-train');
  const modes = new Set();
  const pairs = [['Londyn', 'Paryż'], ['Paryż', 'Londyn'], ['Paryż', 'Amsterdam'],
    ['Amsterdam', 'Paryż'], ['Londyn', 'Amsterdam'], ['Amsterdam', 'Londyn']];
  for (const [origin, destination] of pairs) {
    const results = await search({ origin, destination });
    assert.ok(results.length >= 2);
    for (const trip of results) {
      for (const journey of [trip.outbound, trip.returnJourney]) {
        for (const [index, segment] of journey.segments.entries()) {
          modes.add(segment.mode);
          assert.ok(Date.parse(segment.departureAt) < Date.parse(segment.arrivalAt));
          if (index > 0) {
            const previous = journey.segments[index - 1];
            assert.equal(previous.destination.name, segment.origin.name);
            assert.ok(Date.parse(previous.arrivalAt) <= Date.parse(segment.departureAt));
          }
        }
      }
    }
  }
  for (const mode of ['TRAIN', 'PLANE', 'COACH', 'FERRY', 'BUS', 'METRO', 'TRAM']) assert.ok(modes.has(mode), mode);
  assert.deepEqual(await search({ destination: 'Berlin' }), []);
  const early = budget.find((trip) => trip.id === 'lp-early');
  const late = budget.find((trip) => trip.id === 'lp-coach');
  const items = [{ id: 'park', attractionId: 'tuileries', startsAt: late.returnJourney.departureAt.slice(0, 10) + 'T12:30:00+01:00',
    visitMinutes: 45, automaticTime: false }];
  const shorter = await apiRequest(app, 'POST', '/plans/preview', { criteria, selectedRoundTrip: early, items });
  assert.equal(shorter.status, 200);
  assert.ok(shorter.body.items[0].conflicts.some((conflict) => conflict.code === 'RETURN_DEPARTURE'));

  const input = { criteria, roundTripId: budget[0].id, interest: 'OUTDOORS', budgetPln: 0 };
  const suggestions = await apiRequest(app, 'POST', '/recommendations', input);
  assert.equal(suggestions.status, 200);
  assert.equal(suggestions.body.aiUsed, false);
  assert.deepEqual(suggestions.body.suggestions.map((item) => item.attractionId), ['tuileries']);
  assert.equal((await apiRequest(app, 'POST', '/recommendations', { ...input, budgetPln: -1 })).status, 400);

  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 894, height: 883 } });
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Uzupełnij przykładową trasę' }).click();
  await page.locator('#departureDate').fill(criteria.departureDate);
  await page.locator('#returnDate').fill(criteria.returnDate);
  await page.getByRole('button', { name: /Znajdź połączenia/ }).click();
  await page.getByRole('heading', { name: 'Londyn → Paryż' }).waitFor();
  await page.getByLabel('Zainteresowania').selectOption('OUTDOORS');
  await page.getByLabel('Budżet na wstępy (zł)').fill('0');
  await page.getByRole('button', { name: 'Zaproponuj atrakcje' }).click();
  await page.getByText('Propozycje z katalogu', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Dodaj do planu: Jardin des Tuileries' }).click();
  await page.locator('.schedule').getByRole('heading', { name: 'Jardin des Tuileries' }).waitFor();
  await page.getByRole('button', { name: /Zapisz plan/ }).click();
  await page.getByLabel('Link tylko do odczytu').waitFor();
  console.log('PASS showcase: SQLite, all six directions, modes, ranking, recommendations fallback and browser save.');
} finally {
  try { await browser?.close(); } finally { await app.stop(); }
}
