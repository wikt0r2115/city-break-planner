import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { SEARCH_TIMEOUT_MS } from './api';
import type { PlanInput } from './types';
import { criteria, earlyTrip, planFor, result, savedPlan } from './test/fixtures';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { window.history.replaceState({}, '', '/'); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { window.history.replaceState({}, '', '/'); localStorage.clear(); sessionStorage.clear(); });
function fillSearch() {
  const navigation = screen.queryByRole('navigation', { name: 'Etapy planowania' });
  const direction = navigation && within(navigation).getByRole('button', { name: 'Kierunek' });
  if (direction && direction.getAttribute('aria-current') !== 'step') fireEvent.click(direction);
  fireEvent.change(screen.getByLabelText('Miejsce startu'), { target: { value: criteria.origin } });
  fireEvent.change(screen.getByLabelText('Cel podróży'), { target: { value: criteria.destination } });
  fireEvent.change(screen.getByLabelText('Data wyjazdu'), { target: { value: criteria.departureDate } });
  fireEvent.change(screen.getByLabelText('Data powrotu'), { target: { value: criteria.returnDate } });
}
function mockApi() {
  const previews: PlanInput[] = [];
  const fetch = vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url.endsWith('/places')) return json({ places: [], testData: true });
    if (url.includes('/searches')) return json({ ...result, criteria: JSON.parse(String(options.body)) });
    if (url.endsWith('/recommendations')) return json({
      suggestions: [{ attractionId: 'test-gallery', reason: 'Pasuje do zainteresowań.' }], aiUsed: false,
    });
    if (url.endsWith('/plans/preview')) { const input = JSON.parse(String(options.body)) as PlanInput; previews.push(input); return json(planFor(input)); }
    if (url.endsWith('/plans') && options.method === 'POST') { const input = JSON.parse(String(options.body)) as PlanInput; return json({ plan: { ...planFor(input), id: savedPlan.id, shareUrl: savedPlan.shareUrl }, ownerToken: 'private-test-owner-token' }, 201); }
    if (url.includes('/shared-plans/')) { const { shareUrl: _private, ...publicPlan } = savedPlan; return json(publicPlan); }
    if (url.endsWith('/plans/saved-test') && options.method === 'GET') return json(savedPlan);
    if (url.endsWith('/plans/saved-test') && options.method === 'PUT') return json({ ...planFor(JSON.parse(String(options.body)) as PlanInput), id: savedPlan.id, shareUrl: savedPlan.shareUrl });
    if (url.endsWith('/plans/saved-test') && options.method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected API request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch); return { fetch, previews };
}
async function goStage(name: string) {
  const button = within(screen.getByRole('navigation', { name: 'Etapy planowania' })).getByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
}
async function openSchedule() {
  await goStage('Atrakcje'); fireEvent.click(screen.getByRole('button', { name: /^Harmonogram \(/ }));
}
async function openCatalog(name?: string) {
  await goStage('Atrakcje'); fireEvent.click(screen.getByRole('button', { name: 'Propozycje' }));
  if (name) for (let attempt = 0; attempt < 3 && !screen.queryByRole('heading', { name }); attempt++) {
    const next = screen.getByRole('button', { name: 'Następna atrakcja' });
    if (next.hasAttribute('disabled')) throw new Error(`Nie znaleziono atrakcji ${name}`);
    fireEvent.click(next);
  }
}
async function chooseEarlyTrip() {
  await goStage('Połączenie');
  if (!screen.queryByRole('button', { name: /^Wariant 2, powrót/ })) fireEvent.click(within(screen.getByRole('navigation', { name: 'Strony wyników' })).getByRole('button', { name: 'Następna' }));
  fireEvent.click(screen.getByRole('button', { name: /^Wariant 2, powrót/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dalej: Nocleg' })).toBeEnabled());
}
async function openSummary() {
  const summary = within(screen.getByRole('navigation', { name: 'Etapy planowania' })).getByRole('button', { name: 'Podsumowanie' });
  if (!summary.hasAttribute('disabled')) { fireEvent.click(summary); return; }
  await goStage('Atrakcje');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dalej: Podsumowanie' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Dalej: Podsumowanie' }));
}
async function startPlan() {
  fillSearch(); fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
  await screen.findByRole('heading', { name: 'Wybierz połączenie' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dalej: Nocleg' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Dalej: Nocleg' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pomiń nocleg' }));
  await screen.findByRole('heading', { name: 'Twój plan zwiedzania' });
  fireEvent.click(screen.getByRole('button', { name: 'Dodaj: Muzeum testowe' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dalej: Podsumowanie' })).toBeEnabled());
}
function openRecommendations() {
  const summary = screen.getByText('Dobierz atrakcje'); const details = summary.closest('details');
  if (details && !details.open) fireEvent.click(summary);
}

describe('wyszukiwanie i planowanie z API', () => {
  it('Nowy plan resetuje atrakcje, wybór noclegu i przywracany szkic, zachowując zapisany plan', async () => {
    mockApi(); render(<App />); await startPlan();
    await openSchedule();
    expect(screen.getByRole('heading', { name: 'Muzeum testowe' })).toBeInTheDocument();
    await openSummary(); fireEvent.click(screen.getByRole('button', { name: /Zapisz plan/ }));
    await screen.findByLabelText('Link tylko do odczytu');
    fireEvent.click(screen.getByRole('button', { name: /Nowy plan/ }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByLabelText('Cel podróży')).toHaveValue('');
    expect(document.querySelectorAll('.schedule > li')).toHaveLength(0);
    expect(screen.queryByLabelText('Link tylko do odczytu')).not.toBeInTheDocument();
    expect(localStorage.getItem('city-break-owner:saved-test')).toBeTruthy();
    fillSearch(); fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    await screen.findByRole('heading', { name: 'Wybierz połączenie' });
    expect(document.querySelectorAll('.schedule > li')).toHaveLength(0);
  });

  it('wybiera liczbę osób w Kierunku i przekazuje ją do transportu oraz noclegu', async () => {
    const { fetch } = mockApi(); render(<App />); fillSearch();
    fireEvent.change(screen.getByLabelText('Liczba osób'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    await screen.findByRole('heading', { name: 'Wybierz połączenie' });
    expect(JSON.parse(String(fetch.mock.calls.find(([url]) => url.endsWith('/searches'))?.[1]?.body)).travelers).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Dalej: Nocleg' }));
    const stay = screen.getByRole('region', { name: 'Noclegi OBO Travel' });
    expect(within(stay).queryByRole('spinbutton', { name: 'Liczba osób' })).not.toBeInTheDocument();
    expect(within(stay).getByText(/3 os. dorosłych · 1 pokój/)).toBeInTheDocument();
    await goStage('Kierunek');
    expect(screen.getByLabelText('Liczba osób')).toHaveValue(3);
    fireEvent.change(screen.getByLabelText('Liczba osób'), { target: { value: '4' } });
    expect(within(screen.getByRole('navigation', { name: 'Etapy planowania' })).getByRole('button', { name: 'Nocleg' })).toBeDisabled();
  });

  it.each(['0', '9', '1.5'])('odrzuca niepoprawną liczbę osób %s przed wyszukiwaniem', async (value) => {
    const { fetch } = mockApi(); render(<App />); fillSearch();
    fireEvent.change(screen.getByLabelText('Liczba osób'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    expect(screen.getByText('Wybierz od 1 do 8 osób.')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/searches'))).toBe(false);
  });

  it('pobiera propozycje na żądanie i odświeża je przy zmianie powrotu', async () => {
    const { fetch, previews } = mockApi();
    render(<App />);
    await startPlan();
    const requested = () => fetch.mock.calls.filter(([url]) => url.endsWith('/recommendations'));
    expect(requested()).toHaveLength(0);

    openRecommendations();
    const budget = screen.getByLabelText('Budżet na wstępy (zł)');
    const recommend = screen.getByRole('button', { name: 'Zaproponuj atrakcje' });
    fireEvent.change(budget, { target: { value: '-1' } });
    fireEvent.click(recommend);
    expect(budget).toHaveAttribute('aria-invalid', 'true');
    expect(requested()).toHaveLength(0);
    fireEvent.change(budget, { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Zainteresowania'), { target: { value: 'CULTURE' } });
    fireEvent.click(recommend);
    const add = await screen.findByRole('button', { name: 'Dodaj do planu: Galeria testowa' });
    expect(JSON.parse(String(requested()[0][1]?.body))).toMatchObject({
      roundTripId: result.roundTripOptions[0].id, interest: 'CULTURE', budgetPln: 0,
    });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(() => expect(previews.at(-1)?.items.map((item) => item.attractionId)).toContain('test-gallery'));
    await waitFor(() => expect(recommend).toBeEnabled());
    await chooseEarlyTrip();
    await waitFor(() => expect(screen.queryByText('Propozycje z katalogu')).not.toBeInTheDocument());
    expect(requested()).toHaveLength(1);
  });

  it('waliduje pola i daty, ustawia komunikaty przy polach i fokus bez wyszukiwania połączeń', async () => {
    const { fetch } = mockApi();
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    expect(screen.getByText('Wpisz miejsce startu.')).toBeInTheDocument();
    expect(screen.getByLabelText('Miejsce startu')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Miejsce startu')).toHaveFocus();
    fillSearch(); fireEvent.change(screen.getByLabelText('Data powrotu'), { target: { value: '2099-12-04' } });
    fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    expect(screen.getByText('Powrót nie może poprzedzać wyjazdu.')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/searches'))).toBe(false);
  });

  it('wysyła pojedynczy wybrany priorytet, pokazuje taryfy i wyraźnie oznacza dane testowe', async () => {
    const { fetch } = mockApi(); render(<App />); fillSearch();
    fireEvent.click(screen.getByRole('radio', { name: /Krótszy dojazd/ }));
    fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    await screen.findByRole('heading', { name: 'Wybierz połączenie' });
    for (const summary of screen.getAllByText(/^Ceny i etapy:/)) fireEvent.click(summary);
    const search = fetch.mock.calls.find(([url]) => url === 'http://localhost:8080/api/v1/searches');
    expect(JSON.parse(String(search?.[1]?.body)).priority).toBe('SHORTEST_TRAVEL_TIME');
    expect(await within(screen.getByRole('banner')).findByRole('note')).toHaveTextContent(/testowe|demonstracyjne/i);
    expect(screen.getAllByText('Ulgowa:', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Testowa ulga dla studentów.', { exact: false }).length).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Strony wyników' })).getByRole('button', { name: 'Następna' }));
    for (const summary of screen.getAllByText(/^Ceny i etapy:/)) fireEvent.click(summary);
    expect(screen.getAllByText('Łączny koszt niepotwierdzony').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Strona przewoźnika/ })[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText(/najtańsz/i)).not.toBeInTheDocument();
  });

  it.each([
    ['NO_CONNECTION', 'Brak potwierdzonych połączeń'],
    ['PROVIDER_ERROR', 'Nie udało się sprawdzić połączeń'],
  ])('rozróżnia stan %s', async (status, heading) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/places')
      ? json({ places: [], testData: false })
      : json({ ...result, status, roundTripOptions: [], testData: false })));
    render(<App />); fillSearch(); fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Twój plan zwiedzania' })).not.toBeInTheDocument();
  });

  it('zachowuje punkty po wcześniejszym powrocie, pokazuje powód konfliktu i obsługuje dodanie, kolejność, usunięcie i zapis', async () => {
    const { fetch, previews } = mockApi(); render(<App />); await startPlan();
    const original = previews.find((preview) => preview.items.length > 0)!.items[0];
    await chooseEarlyTrip();
    await openSchedule();
    await screen.findByText('Nie zdążysz na wcześniejszy powrót po tej wizycie.');
    expect(previews.at(-1)?.selectedRoundTrip.id).toBe(earlyTrip.id);
    expect(previews.at(-1)?.items[0].id).toBe(original.id);
    expect(previews.at(-1)?.items[0].startsAt).not.toBeNull();
    await openCatalog('Galeria testowa');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dodaj: Galeria testowa' })).toBeEnabled());
    await openCatalog('Galeria testowa');
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj: Galeria testowa' }));
    await openSchedule();
    await screen.findByRole('button', { name: 'Przesuń Galeria testowa wcześniej' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Przesuń Galeria testowa wcześniej' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Przesuń Galeria testowa wcześniej' }));
    await waitFor(() => expect(previews.at(-1)?.items[0].attractionId).toBe('test-gallery'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Usuń Muzeum testowe' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Usuń Muzeum testowe' }));
    await waitFor(() => expect(previews.at(-1)?.items).toHaveLength(1));
    await openSummary();
    await waitFor(() => expect(screen.getByRole('button', { name: /Zapisz plan/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Zapisz plan/ }));
    expect(await screen.findByText(/Plan zapisany. Możesz udostępnić/)).toBeInTheDocument();
    expect(localStorage.getItem('city-break-owner:saved-test')).toBe('private-test-owner-token');
    expect(window.location.pathname).toBe('/plans/saved-test');
    expect(window.location.href).not.toContain('private-test-owner-token');
    expect(screen.getByLabelText('Link tylko do odczytu')).toHaveValue(savedPlan.shareUrl);
    expect(document.body.textContent).not.toContain('private-test-owner-token');
    const create = fetch.mock.calls.find(([url, options]) => url.endsWith('/plans') && options?.method === 'POST');
    expect(create).toBeDefined(); expect(JSON.parse(String(create?.[1]?.body)).items[0].attractionId).toBe('test-gallery');
  });

  it('po zmianie kolejności przelicza godziny automatyczne i zachowuje godzinę ręczną', async () => {
    const { previews } = mockApi();
    render(<App />);
    await startPlan();

    await openCatalog('Galeria testowa');
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj: Galeria testowa' }));
    await openSchedule();
    const moveGallery = await screen.findByRole('button', { name: 'Przesuń Galeria testowa wcześniej' });
    await waitFor(() => expect(moveGallery).toBeEnabled());
    fireEvent.click(moveGallery);
    await waitFor(() => expect(previews.at(-1)?.items).toEqual([
      expect.objectContaining({ attractionId: 'test-gallery', startsAt: null, automaticTime: true }),
      expect.objectContaining({ attractionId: 'test-museum', startsAt: null, automaticTime: true }),
    ]));
    const galleryTime = screen.getByLabelText(/Początek wizyty Galeria testowa/);
    const museumTime = screen.getByLabelText(/Początek wizyty Muzeum testowe/);
    await waitFor(() => expect(galleryTime).toHaveValue('2099-12-06T11:00'));
    expect(museumTime).toHaveValue('2099-12-06T14:00');

    fireEvent.change(museumTime, { target: { value: '2099-12-06T15:00' } });
    const museum = museumTime.closest('li')!;
    fireEvent.click(within(museum).getByRole('button', { name: 'Ustaw ręcznie' }));
    const resetToAutomatic = await within(museum).findByRole('button', { name: 'Ustaw automatycznie' });
    const moveMuseum = within(museum).getByRole('button', { name: 'Przesuń Muzeum testowe wcześniej' });
    await waitFor(() => expect(moveMuseum).toBeEnabled());
    fireEvent.click(moveMuseum);
    await waitFor(() => expect(previews.at(-1)?.items).toEqual([
      expect.objectContaining({ attractionId: 'test-museum', startsAt: '2099-12-06T14:00:00.000Z', automaticTime: false }),
      expect.objectContaining({ attractionId: 'test-gallery', startsAt: null, automaticTime: true }),
    ]));
    expect(museumTime).toHaveValue('2099-12-06T15:00');
    await waitFor(() => expect(resetToAutomatic).toBeEnabled());
    fireEvent.click(resetToAutomatic);
    await waitFor(() => expect(museumTime).toHaveValue('2099-12-06T11:00'));
    expect(previews.at(-1)?.items[0]).toEqual(expect.objectContaining({ startsAt: null, automaticTime: true }));
  });

  it('otwiera zapisany plan z uprawnieniem właściciela i odświeża katalog bez nadpisania punktów', async () => {
    const { fetch, previews } = mockApi(); localStorage.setItem('city-break-owner:saved-test', 'private-test-owner-token');
    window.history.replaceState({}, '', '/plans/saved-test'); render(<App />);
    await screen.findByRole('heading', { name: 'Twój wyjazd jest gotowy' });
    const read = fetch.mock.calls.find(([url, options]) => url.endsWith('/plans/saved-test') && options?.method === 'GET');
    expect(read?.[1]?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer private-test-owner-token' }));
    expect(previews).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Zapisz zmiany/ })).toBeDisabled();
    await openSchedule();
    expect(screen.getByRole('button', { name: 'Usuń Muzeum testowe' })).toBeInTheDocument();
  });

  it('nieudany podgląd nowej trasy zachowuje zapisany plan i aktualizuje go zamiast tworzyć kopię', async () => {
    const { fetch } = mockApi();
    const originalApi = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url.endsWith('/searches') && JSON.parse(String(options.body)).destination === 'Kraków')
        return json({ ...result, criteria: { ...criteria, destination: 'Kraków' }, attractions: [] });
      if (url.endsWith('/plans/preview') && JSON.parse(String(options.body)).criteria.destination === 'Kraków')
        return json({ detail: 'Źródło podglądu jest niedostępne.' }, 503);
      return originalApi(url, options);
    });
    localStorage.setItem('city-break-owner:saved-test', 'private-test-owner-token');
    window.history.replaceState({}, '', '/plans/saved-test');
    render(<App />);
    await screen.findByRole('heading', { name: 'Twój wyjazd jest gotowy' });
    await goStage('Kierunek');
    await waitFor(() => expect(screen.getByRole('button', { name: /Znajdź połączenia/ })).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Cel podróży'), { target: { value: 'Kraków' } });
    fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Źródło podglądu jest niedostępne.');
    expect(screen.getByRole('button', { name: 'Wróć do poprzedniego planu' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wróć do poprzedniego planu' }));
    await openSummary();
    expect(screen.getByLabelText('Link tylko do odczytu')).toHaveValue(savedPlan.shareUrl);
    expect(screen.getByRole('button', { name: 'Usuń zapisany plan' })).toBeInTheDocument();

    await chooseEarlyTrip();
    await openSchedule();
    await screen.findByText('Nie zdążysz na wcześniejszy powrót po tej wizycie.');
    await openSummary();
    await waitFor(() => expect(screen.getByRole('button', { name: /Zapisz zmiany/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Zapisz zmiany/ }));
    await waitFor(() => expect(fetch.mock.calls.some(([url, options]) => url.endsWith('/plans/saved-test') && options?.method === 'PUT')).toBe(true));
    expect(fetch.mock.calls.some(([url, options]) => url.endsWith('/plans') && options?.method === 'POST')).toBe(false);
  });

  it.each(['NO_CONNECTION', 'PROVIDER_ERROR'])('zmiana powrotu bez wariantów (%s) nie usuwa wybranych punktów ani zapisu', async (status) => {
    const { fetch, previews } = mockApi();
    const originalApi = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url.endsWith('/searches') && JSON.parse(String(options.body)).returnDate === '2099-12-07')
        return json({ ...result, criteria: { ...criteria, returnDate: '2099-12-07' }, status, roundTripOptions: [], attractions: [] });
      return originalApi(url, options);
    });
    localStorage.setItem('city-break-owner:saved-test', 'private-test-owner-token');
    window.history.replaceState({}, '', '/plans/saved-test');
    render(<App />);
    await screen.findByRole('heading', { name: 'Twój wyjazd jest gotowy' });
    await goStage('Kierunek');
    await waitFor(() => expect(screen.getByRole('button', { name: /Znajdź połączenia/ })).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Data powrotu'), { target: { value: '2099-12-07' } });
    fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Poprzedni plan, wybrane punkty i uprawnienia zostały zachowane.');
    fireEvent.click(screen.getByRole('button', { name: 'Wróć do poprzedniego planu' }));
    await openSchedule();
    expect(screen.getByRole('button', { name: 'Usuń Muzeum testowe' })).toBeInTheDocument();
    await openSummary();
    expect(screen.getByRole('button', { name: 'Usuń zapisany plan' })).toBeInTheDocument();
    expect(screen.getByLabelText('Link tylko do odczytu')).toHaveValue(savedPlan.shareUrl);
    expect(screen.getByRole('heading', { name: 'Twój wyjazd jest gotowy' })).toBeInTheDocument();
    expect(previews).toHaveLength(0);
  });

  it('po utracie połączenia zachowuje czytelny błąd i pozwala ponowić wyszukiwanie', async () => {
    const search = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(json({ ...result, status: 'NO_CONNECTION', roundTripOptions: [] }));
    const fetch = vi.fn((url: string) => url.endsWith('/places') ? Promise.resolve(json({ places: [], testData: true })) : search());
    vi.stubGlobal('fetch', fetch); render(<App />); fillSearch();
    fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nie udało się połączyć');
    fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    await screen.findByRole('heading', { name: 'Brak potwierdzonych połączeń' });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('kończy wiszące żądanie i ponownie udostępnia przycisk wyszukiwania', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => { options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); })));
    render(<App />); fillSearch(); fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Szukamy połączeń');
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS - 1); });
    expect(screen.getByRole('button', { name: /Znajdź połączenia/ })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole('alert')).toHaveTextContent('Odpowiedź trwała zbyt długo');
    expect(screen.getByRole('button', { name: /Znajdź połączenia/ })).toBeEnabled();
  });
});

describe('publiczny plan tylko do odczytu', () => {
  it.each(['/shared/%', '/plans/%'])('obsługuje nieprawidłowe kodowanie linku %s', (path) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    window.history.replaceState({}, '', path); render(<App />);
    expect(screen.getByRole('heading', { name: 'Nieprawidłowy link do planu.' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('nie przesyła tokenu właściciela i nie pokazuje kontrolek edycji ani poświadczeń', async () => {
    const { fetch } = mockApi(); localStorage.setItem('city-break-owner:saved-test', 'private-test-owner-token');
    window.history.replaceState({}, '', '/shared/test-public-token'); render(<App />);
    expect(await screen.findByText('Tylko do odczytu')).toBeInTheDocument();
    expect(fetch.mock.calls[0][0]).toContain('/shared-plans/test-public-token');
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private-test-owner-token');
    const links = screen.getAllByRole('link', { name: /Strona przewoźnika/ });
    expect(links[0]).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Plan zwiedzania' })).toBeInTheDocument();
  });

  it('obsługuje usunięty publiczny plan', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: 'Ten plan nie istnieje lub został usunięty.' }, 404)));
    window.history.replaceState({}, '', '/shared/deleted'); render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Ten plan nie istnieje lub został usunięty.');
    expect(screen.queryByRole('button', { name: /Zapisz/ })).not.toBeInTheDocument();
  });
});
