import assert from 'node:assert/strict';
import { apiRequest, buildApp, launchBrowser, startApp } from './harness.mjs';

const date = process.env.E2E_RAIL_DATE;
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  throw new Error('Set E2E_RAIL_DATE to a future date covered by the official SKM feed.');
}

await buildApp();
const app = await startApp({ mode: 'live', aiProvider: 'off' });
let browser;
try {
  const criteria = {
    origin: 'Gdansk', destination: 'Gdynia', departureDate: date, returnDate: date,
    priority: 'LOWEST_TOTAL_COST', currency: 'PLN', fareType: 'STANDARD',
  };
  for (const [destination, station] of [['Gdynia', 'Gdynia Główna'], ['Wejherowo', 'Wejherowo']]) {
    const query = { ...criteria, destination };
    const response = await apiRequest(app, 'POST', '/searches', query);
    assert.equal(response.status, 200);
    const result = response.body;
    assert.equal(result.testData, false);
    assert.equal(result.criteria.origin, 'Gdańsk Główny');
    assert.equal(result.criteria.destination, station);
    assert.ok(result.roundTripOptions.length > 1, JSON.stringify(result.sources));
    assert.ok(new Set(result.roundTripOptions.map((trip) => trip.returnJourney.departureAt)).size > 1);
    assert.ok(result.sources.some((source) => source.reasonCode === 'AI_NOT_CONFIGURED'));
    for (const trip of result.roundTripOptions) {
      const [out] = trip.outbound.segments;
      const [back] = trip.returnJourney.segments;
      assert.equal(out.destination.name, station);
      assert.equal(back.origin.name, station);
      assert.equal(back.destination.name, 'Gdańsk Główny');
      assert.equal(trip.costSummary.total, null);
      for (const segment of [out, back]) {
        assert.equal(segment.scheduleBasis, 'PLANNED');
        assert.equal(segment.scheduleSourceUrl, 'https://bip.skm.pkp.pl/otwarte-dane');
        assert.ok(segment.schedulePublishedAt && segment.scheduleCheckedAt);
        assert.ok(segment.departureAt.startsWith(date));
      }
    }
    console.log(`PASS: Gdańsk ↔ ${destination}, ${result.roundTripOptions.length} verified round-trip options.`);
  }

  const outside = new Date(`${date}T12:00:00Z`);
  outside.setUTCDate(outside.getUTCDate() + 400);
  const outsideDate = outside.toISOString().slice(0, 10);
  const distant = await apiRequest(app, 'POST', '/searches', { ...criteria, departureDate: outsideDate, returnDate: outsideDate });
  assert.equal(distant.body.status, 'PARTIAL');
  assert.deepEqual(distant.body.roundTripOptions, []);
  assert.ok(distant.body.sources.some((source) => source.reasonCode === 'OUTSIDE_COVERAGE'));

  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 894, height: 883 }, locale: 'pl-PL' });
  await page.goto(app.url);
  await page.locator('#origin').fill(criteria.origin);
  await page.locator('#destination').fill(criteria.destination);
  await page.locator('#departureDate').fill(date);
  await page.locator('#returnDate').fill(date);
  await page.getByRole('button', { name: /Znajdź połączenia/ }).click();
  await page.getByRole('heading', { name: 'Twój plan zwiedzania' }).waitFor();
  const cards = page.locator('.trip-card');
  assert.equal(await cards.count(), 2);
  assert.ok(await cards.first().getByText('Rozkład planowany', { exact: true }).count());
  assert.ok(await cards.first().getByText('Cena niedostępna', { exact: true }).count());
  const other = cards.nth(1).getByRole('button', { name: /^Wariant / });
  await other.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.trip-card')[1]?.classList.contains('chosen'));
  await page.getByRole('button', { name: /Zapisz plan/ }).click();
  const share = page.getByLabel('Link tylko do odczytu', { exact: true });
  await share.waitFor();
  const publicPage = await browser.newPage();
  await publicPage.goto(await share.inputValue());
  await publicPage.getByText('Tylko do odczytu', { exact: true }).waitFor();
  assert.ok(await publicPage.getByRole('link', { name: /Źródło rozkładu/ }).count());
  console.log('PASS: outside coverage, rail search, another return, save and public view.');
} finally {
  try { await browser?.close(); } finally { await app.stop(); }
}
