import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { REQUEST_TIMEOUT_MS } from './api';
import type { PlanInput } from './types';
import { criteria, earlyTrip, planFor, result, savedPlan } from './test/fixtures';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { window.history.replaceState({}, '', '/'); localStorage.clear(); });
afterEach(() => { window.history.replaceState({}, '', '/'); localStorage.clear(); });
function fillSearch() {
  fireEvent.change(screen.getByLabelText('Miejsce startu'), { target: { value: criteria.origin } });
  fireEvent.change(screen.getByLabelText('Cel podróży'), { target: { value: criteria.destination } });
  fireEvent.change(screen.getByLabelText('Data wyjazdu'), { target: { value: criteria.departureDate } });
  fireEvent.change(screen.getByLabelText('Data powrotu'), { target: { value: criteria.returnDate } });
}
function mockApi() {
  const previews: PlanInput[] = [];
  const fetch = vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url.endsWith('/places')) return json({ places: [], testData: true });
    if (url.endsWith('/searches')) return json(result);
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
async function startPlan() { fillSearch(); fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ })); await screen.findByRole('heading', { name: 'Twój plan zwiedzania' }); await waitFor(() => expect(screen.getByRole('button', { name: /Zapisz plan/ })).toBeEnabled()); }

describe('wyszukiwanie i planowanie z API', () => {
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
    await screen.findByRole('heading', { name: 'Twój plan zwiedzania' });
    const search = fetch.mock.calls.find(([url]) => url === 'http://localhost:8080/api/v1/searches');
    expect(JSON.parse(String(search?.[1]?.body)).priority).toBe('SHORTEST_TRAVEL_TIME');
    expect(screen.getByText('Dane testowe — to nie są rzeczywiste oferty.')).toBeInTheDocument();
    expect(screen.getAllByText('Ulgowa:', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Testowa ulga dla studentów.', { exact: false })).not.toBeInTheDocument();
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
    const original = previews[0].items[0];
    fireEvent.click(screen.getByRole('button', { name: /^Wariant 2, powrót/ }));
    await screen.findByText('Nie zdążysz na wcześniejszy powrót po tej wizycie.');
    expect(previews.at(-1)?.selectedRoundTrip.id).toBe(earlyTrip.id);
    expect(previews.at(-1)?.items[0].id).toBe(original.id);
    expect(previews.at(-1)?.items[0].startsAt).not.toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dodaj: Galeria testowa' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj: Galeria testowa' }));
    await screen.findByRole('button', { name: 'Przesuń Galeria testowa wcześniej' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Przesuń Galeria testowa wcześniej' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Przesuń Galeria testowa wcześniej' }));
    await waitFor(() => expect(previews.at(-1)?.items[0].attractionId).toBe('test-gallery'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Usuń Muzeum testowe' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Usuń Muzeum testowe' }));
    await waitFor(() => expect(previews.at(-1)?.items).toHaveLength(1));
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

    fireEvent.click(screen.getByRole('button', { name: 'Dodaj: Galeria testowa' }));
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
    await screen.findByRole('heading', { name: 'Twój plan zwiedzania' });
    const read = fetch.mock.calls.find(([url, options]) => url.endsWith('/plans/saved-test') && options?.method === 'GET');
    expect(read?.[1]?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer private-test-owner-token' }));
    expect(screen.getByRole('button', { name: 'Usuń Muzeum testowe' })).toBeInTheDocument();
    expect(previews).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Zapisz zmiany/ })).toBeDisabled();
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
    await screen.findByRole('heading', { name: 'Twój plan zwiedzania' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Znajdź połączenia/ })).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Cel podróży'), { target: { value: 'Kraków' } });
    fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Źródło podglądu jest niedostępne.');
    expect(screen.getByLabelText('Link tylko do odczytu')).toHaveValue(savedPlan.shareUrl);
    expect(screen.getByRole('button', { name: 'Usuń zapisany plan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Warszawa → Gdańsk' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Wariant 2, powrót/ }));
    await screen.findByText('Nie zdążysz na wcześniejszy powrót po tej wizycie.');
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
    await screen.findByRole('heading', { name: 'Twój plan zwiedzania' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Znajdź połączenia/ })).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Data powrotu'), { target: { value: '2099-12-07' } });
    fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Poprzedni plan, wybrane punkty i uprawnienia zostały zachowane.');
    expect(screen.getByRole('button', { name: 'Usuń Muzeum testowe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usuń zapisany plan' })).toBeInTheDocument();
    expect(screen.getByLabelText('Link tylko do odczytu')).toHaveValue(savedPlan.shareUrl);
    expect(screen.getByRole('heading', { name: 'Warszawa → Gdańsk' })).toBeInTheDocument();
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
    await act(async () => { await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS); });
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
