import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

process.env.VITE_MAPTILER_API_KEY = 'stays-map-integration-test';
const { buildApp, futureDate, launchBrowser, startApp } = await import('./harness.mjs');
await buildApp();
const app = await startApp();
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  await page.clock.install();
  await fs.mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
  async function checkLayout(stage) {
    for (const viewport of [{width:1440,height:900},{width:1280,height:800},{width:390,height:844},{width:360,height:740}]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const nav = document.querySelector('.wizard-navigation').getBoundingClientRect();
        return {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,
          navBottom:nav.bottom,navHeight:nav.height,panels:[...document.querySelectorAll('.wizard-step')].filter(p=>!p.hidden).length};
      });
      assert.ok(layout.width<=viewport.width+1,stage+' horizontal overflow');
      assert.ok(layout.height<=viewport.height+1,stage+' document scroll');
      assert.ok(layout.navBottom<=viewport.height+1&&layout.navHeight>0,stage+' navigation must remain visible');
      assert.equal(layout.panels,1,'Only one selection stage may be visible.');
      if(viewport.width===1440||viewport.width===390)await page.screenshot({path:new URL('./artifacts/wizard-'+stage+'-'+viewport.width+'.png',import.meta.url).pathname});
      if(stage==='stay'&&viewport.width===390) {
        const toggle = page.getByRole('group', {name:'Widok bieżącego kroku'});
        await toggle.getByRole('button', {name:'Mapa',exact:true}).click();
        assert.equal(await page.locator(':focus').getAttribute('class'),'wizard-map-pane');
        const canvas = await page.locator('.wizard-map-pane canvas').boundingBox();
        assert.ok(canvas && canvas.width>0 && canvas.height>0,'Revealed mobile map must be resized.');
        await toggle.getByRole('button', {name:'Plan',exact:true}).click();
        assert.equal(await page.locator(':focus').getAttribute('id'),'wizard-stage-title');
      }
    }
    await page.setViewportSize({width:1280,height:960});
  }
  let requests = 0;
  let mode = 'PARTIAL';
  let lastRequest;
  await page.route('https://api.maptiler.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/style.json')) await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      version: 8, sources: {}, layers: [{ id: 'test', type: 'background', paint: { 'background-color': '#e9efe7' } }],
    }) });
    else if (path === '/resources/logo.svg') await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><text x="0" y="20">Test map logo</text></svg>' });
    else await route.abort();
  });
  await page.route('https://onebookingonline.com/test-photo.svg', async (route) => {
    assert.ok(!route.request().headers().referer);
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250"><rect width="400" height="250" fill="#e8dfcb"/><text x="20" y="125">Test hotel photo</text></svg>' });
  });
  await page.route('**/api/v1/stays/search', async (route) => {
    requests++;
    assert.equal(route.request().headers().authorization, undefined);
    const criteria = route.request().postDataJSON();
    lastRequest = criteria;
    const now = await page.evaluate(() => Date.now());
    const checkedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + 60000).toISOString();
    const hotels = ['OK', 'PARTIAL'].includes(mode) ? [{ hotelToken: 'controlled-test-hotel',
      name: 'Hotel E2E — dane testowe', stars: 3, totalPrice: '580.00', nightlyPrice: '290.00',
      currency: criteria.currency, bookingUrl: 'https://onebookingonline.com/hotel/e2e?check_in=test&keep=this',
      taxesIncluded: null, feesIncluded: false,
      extraCharges: [{ name: 'Testowy podatek lokalny', amount: '12.00', currency: 'EUR', payableAt: 'property' }],
      inclusionsNote: 'Kontrolowana oferta testowa, nie rzeczywista cena.', quotedAt: checkedAt, expiresAt,
      photoUrl: 'https://onebookingonline.com/test-photo.svg', location: { latitude: 48.86, longitude: 2.33 },
    }].flatMap((hotel) => [hotel,...[1,2].map(index=>({...hotel,hotelToken:'unselected-'+index,name:'Hotel niewybrany '+index,location:{latitude:48.86+index/100,longitude:2.33+index/100}}))]) : [];
    await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ status: mode, source: 'OBO Travel', checkedAt,
        expiresAt: hotels.length ? expiresAt : null, criteria, hotels,
        message: mode === 'OK' ? null : mode === 'PARTIAL' ? 'Kontrolowany wynik częściowy.'
          : mode === 'RATE_LIMITED' ? 'Kontrolowany limit OBO.'
            : mode === 'EMPTY' ? 'Kontrolowany brak noclegów.' : 'Kontrolowany błąd dostawcy.',
        retryAfterSeconds: mode === 'RATE_LIMITED' ? 2 : null,
      }),
    });
  });
  await page.goto(app.url);
  await page.getByRole('button',{name:'Uzupełnij przykładową trasę'}).waitFor();
  await checkLayout('direction');
  await page.getByRole('button', { name: 'Uzupełnij przykładową trasę' }).click();
  await page.locator('#departureDate').fill(futureDate(7));
  await page.locator('#returnDate').fill(futureDate(9));
  await page.getByLabel('Liczba osób', { exact: true }).fill('3');
  await page.getByRole('button', { name: /Znajdź połączenia/ }).click();
  await page.getByRole('heading', { name: 'Wybierz połączenie' }).waitFor();
  await checkLayout('connection');
  await page.getByRole('button',{name:'Dalej: Nocleg',exact:true}).click();
  const stays = page.getByRole('region', { name: 'Noclegi OBO Travel' });
  await stays.getByRole('heading', { name: 'Nocleg na Twój wyjazd' }).waitFor();
  assert.equal(requests, 0, 'Hotel search must require an explicit action.');
  assert.ok(await page.getByRole('button',{name:'Dalej: Atrakcje',exact:true}).isDisabled(),'Choose or skip accommodation explicitly.');
  assert.equal(await stays.getByLabel('Miasto noclegu').inputValue(), 'Paryż');
  assert.equal(await stays.getByLabel('Zameldowanie', { exact: true }).inputValue(), futureDate(7));
  const search = stays.getByRole('button', { name: 'Sprawdź noclegi', exact: true });
  await stays.getByLabel('Liczba pokoi', {exact:true}).fill('2');
  await search.click();
  await stays.getByRole('heading', { name: /Hotel E2E — dane testowe/ }).waitFor();
  assert.deepEqual(lastRequest, { destination: 'Paryż', checkIn: futureDate(7), checkOut: futureDate(9), adults: 3, currency: 'PLN', rooms: 2 });
  assert.equal(await stays.getByLabel('Liczba dorosłych').count(),0,'Group size is editable only in Kierunek.');
  assert.equal(await stays.getByText('Kontrolowany wynik częściowy.',{exact:true}).count(),0);
  await page.waitForFunction(()=>document.querySelectorAll('.hotel-marker').length===3);
  assert.equal(await stays.locator('.stay-card').count(),1);
  await stays.getByText('Szczegóły ceny i opłat',{exact:true}).click();
  const booking = stays.locator('a').filter({hasText:'Sprawdź ofertę w OBO'});
  assert.equal(await booking.getAttribute('href'), 'https://onebookingonline.com/hotel/e2e?check_in=test&keep=this');
  assert.ok((await booking.getAttribute('rel')).includes('noreferrer'));
  assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('controlled-test-hotel'));
  assert.ok((await stays.innerText()).includes('Testowy podatek lokalny'));
  await stays.getByText('Szczegóły ceny i opłat',{exact:true}).click();
  await stays.getByRole('button',{name:'Wybierz nocleg',exact:true}).click();
  await page.getByRole('button',{name:'Dalej: Atrakcje',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelectorAll('.hotel-marker').length===1);
  await checkLayout('stay');
  await page.getByRole('button',{name:'Dalej: Atrakcje',exact:true}).click();
  await page.getByRole('heading',{name:'Twój plan zwiedzania',exact:true}).waitFor();
  const addPreview = page.waitForResponse(r=>r.url().endsWith('/plans/preview')&&r.request().method()==='POST');
  await page.getByRole('button',{name:/^Dodaj:/}).first().click();
  const planned = await (await addPreview).json();
  assert.equal(planned.lodging.name,'Hotel E2E — dane testowe');
  assert.equal(planned.items[0].transferBasis,'ESTIMATED_WALKING');
  assert.ok(planned.items[0].transferMinutesFromPrevious>0);
  await checkLayout('attractions');
  await page.getByRole('button',{name:'Dalej: Podsumowanie',exact:true}).click();
  await checkLayout('summary');
  assert.ok((await page.locator('.wizard-summary').innerText()).includes('Hotel E2E — dane testowe'));
  await page.getByRole('button', {name:/Zapisz plan/}).click();
  const chosenShare = await page.getByLabel('Link tylko do odczytu', {exact:true}).inputValue();
  const chosenPublic = await browser.newPage();
  await chosenPublic.goto(chosenShare);
  await chosenPublic.getByText('Tylko do odczytu', {exact:true}).waitFor();
  const minimalSaved = await (await chosenPublic.request.get(app.api+'/shared-plans/'+new URL(chosenShare).pathname.split('/').at(-1))).json();
  assert.deepEqual(minimalSaved.lodging, {name:'Hotel E2E — dane testowe',latitude:48.86,longitude:2.33});
  assert.equal(minimalSaved.items[0].transferBasis,'ESTIMATED_WALKING');
  assert.ok(!JSON.stringify(minimalSaved).includes('controlled-test-hotel'));
  assert.ok((await chosenPublic.locator('body').innerText()).includes('Szacowane dojście pieszo'));
  await chosenPublic.close();
  await page.getByRole('navigation',{name:'Etapy planowania'}).getByRole('button',{name:'Nocleg',exact:true}).click();
  const photo = stays.getByAltText('Zdjęcie hotelu Hotel E2E — dane testowe');
  await photo.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.stay-photo')?.naturalWidth > 0);
  assert.equal(await photo.evaluate((img) => getComputedStyle(img).objectFit), 'contain');
  await page.locator('.hotel-marker').waitFor();
  await stays.getByRole('button', { name: 'Pokaż na mapie', exact: true }).click();
  await page.locator('.maplibregl-popup-content').filter({ hasText: 'Hotel E2E — dane testowe' }).waitFor();
  await stays.getByText('Parametry noclegu', { exact: true }).click();
  await search.click();
  assert.equal(requests, 1, 'Repeated search of fresh parameters must use the session cache.');
  await page.reload();
  await stays.getByRole('heading', { name: /Hotel E2E — dane testowe/ }).waitFor();
  await page.locator('.hotel-marker').waitFor();
  assert.equal(requests, 1, 'Reload must restore the draft, quotes, photo and hotel markers without another search.');
  assert.equal(await page.getByLabel('Liczba osób', { exact: true }).inputValue(),'3');
  assert.equal(await stays.getByLabel('Liczba pokoi', {exact:true}).inputValue(),'2');
  assert.equal(await page.locator('.hotel-marker').count(),1);
  assert.equal(await stays.getByLabel('Miasto noclegu').inputValue(), 'Paryż');
  assert.equal(await photo.getAttribute('src'), 'https://onebookingonline.com/test-photo.svg');
  const isolated = await browser.newContext();
  const separatePage = await isolated.newPage();
  await separatePage.goto(app.url);
  assert.equal(await separatePage.locator('.stay-card').count(), 0, 'A separate browser session must not inherit quotes.');
  await isolated.close();
  await page.setViewportSize({ width: 360, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await fs.mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
  await stays.screenshot({ path: new URL('./artifacts/stays-mobile.png', import.meta.url).pathname });
  await page.clock.fastForward(61000);
  await stays.getByText(/Ceny wygasły/i).waitFor();
  assert.equal(await booking.count(), 0, 'Expired booking links must be removed.');
  assert.equal(await stays.getByRole('heading', { name: /Hotel E2E — dane testowe/ }).count(), 0);
  assert.equal(await page.locator('.hotel-marker').count(), 1, 'Only the selected lodging location remains after quote expiry, without its price or booking link.');
  mode = 'RATE_LIMITED';
  await search.click();
  await stays.getByText(/partnerzy są w tej chwili niedostępni/).waitFor();
  assert.ok(await search.isDisabled());
  await page.clock.fastForward(2100);
  mode = 'EMPTY';
  await search.click();
  await stays.getByText(/partnerzy są w tej chwili niedostępni/).waitFor();
  mode = 'PROVIDER_ERROR';
  await search.click();
  await stays.getByText(/partnerzy są w tej chwili niedostępni/).waitFor();
  await page.getByRole('button',{name:'Pomiń nocleg',exact:true}).click();
  await page.getByRole('button',{name:'Dalej: Podsumowanie',exact:true}).click();
  let savedPayload;
  page.on('request', (request) => {
    if ((request.url().endsWith('/plans') && request.method() === 'POST') || (request.url().includes('/plans/') && request.method() === 'PUT')) savedPayload = request.postDataJSON();
  });
  await page.getByRole('button', { name: /Zapisz zmiany/ }).click();
  await page.getByLabel('Link tylko do odczytu', { exact: true }).waitFor();
  assert.ok(savedPayload && !JSON.stringify(savedPayload).includes('controlled-test-hotel'));
  const shareUrl = await page.getByLabel('Link tylko do odczytu', { exact: true }).inputValue();
  const publicPage = await browser.newPage();
  await publicPage.goto(shareUrl);
  await publicPage.getByText('Tylko do odczytu', { exact: true }).waitFor();
  assert.equal(await publicPage.getByRole('region', { name: 'Noclegi OBO Travel' }).count(), 0);
  console.log('PASS stays: rooms, one OBO search across reload, partial/empty/error UX, selected-only hotel map, estimated walking schedule, minimal lodging save/public, quote expiry, session isolation and removing lodging.');
} finally {
  try { await browser?.close(); } finally { await app.stop(); }
}
