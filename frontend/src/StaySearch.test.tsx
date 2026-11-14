import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaySearch, STAYS_UNAVAILABLE_MESSAGE } from './StaySearch';
import { nextDate } from './format';
import { criteria as travelCriteria } from './test/fixtures';
import type { Criteria, StayCriteria, StayResult } from './types';

const criteria = (): Criteria => ({ ...travelCriteria, destination: 'Paryż', travelers: 2, departureDate: nextDate(7), returnDate: nextDate(9) });
const stayCriteria = (): StayCriteria => ({ destination: 'Paryż', checkIn: nextDate(7), checkOut: nextDate(9), adults: 2, currency: 'PLN', rooms: 1 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function result(input = stayCriteria(), updates: Partial<StayResult> = {}): StayResult {
  const quotedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  return { status: 'OK', source: 'OBO Travel', checkedAt: quotedAt, expiresAt, criteria: input,
    hotels: [{ hotelToken: 'opaque-quote', name: 'Hotel testowy', stars: 3, totalPrice: '800.00', nightlyPrice: '400.00', currency: 'PLN',
      bookingUrl: 'https://www.onebookingonline.com/hotel?quote=opaque-quote', taxesIncluded: null, feesIncluded: false,
      extraCharges: [{ name: 'Podatek miejski', amount: '12.00', currency: 'EUR', payableAt: 'at_property' }],
      inclusionsNote: 'Warunki z oferty dostawcy.', quotedAt, expiresAt }],
    message: null, retryAfterSeconds: null, ...updates };
}
function mockFetch(response?: StayResult) {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => json(response ?? result(JSON.parse(String(init.body)) as StayCriteria)));
  vi.stubGlobal('fetch', fetch); return fetch;
}
function clickSearch() { fireEvent.click(screen.getByRole('button', { name: 'Sprawdź noclegi' })); }
async function quotes() { await screen.findByRole('link', { name: 'Sprawdź ofertę w OBO' }); }
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe('noclegi OBO na żądanie', () => {
  it('rozdziela cache dla liczby pokoi i zachowuje cenę całego pobytu bez mnożenia', async () => {
    const fetch = mockFetch(); const { unmount } = render(<StaySearch criteria={criteria()} />);
    clickSearch(); await quotes();
    fireEvent.change(screen.getByLabelText('Liczba pokoi'), { target: { value: '2' } });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    clickSearch(); await quotes();
    expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toMatchObject({ rooms: 2, adults: 2 });
    expect(screen.getByText(/za cały pobyt · 2 os. dorosłych · 2 pokoje/)).toHaveTextContent('800,00');
    unmount(); render(<StaySearch criteria={criteria()} />); await quotes();
    expect(screen.getByLabelText('Liczba pokoi')).toHaveValue(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText('Liczba pokoi'), { target: { value: '1' } });
    clickSearch(); await quotes(); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['0', '3', '1.5'])('odrzuca niepoprawną liczbę pokoi %s przed wyszukiwaniem', (value) => {
    const fetch = mockFetch(); render(<StaySearch criteria={criteria()} />);
    fireEvent.change(screen.getByLabelText('Liczba pokoi'), { target: { value } });
    clickSearch();
    expect(screen.getByText('Wybierz od 1 pokoju do liczby osób dorosłych.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('pokazuje dostępne oferty częściowej odpowiedzi bez technicznych komunikatów', async () => {
    mockFetch(result(stayCriteria(), { status: 'PARTIAL', message: 'Niepełna odpowiedź z API' }));
    render(<StaySearch criteria={criteria()} />); clickSearch(); await quotes();
    expect(screen.queryByText(/Niepełna odpowiedź/)).not.toBeInTheDocument();
    expect(screen.queryByText(STAYS_UNAVAILABLE_MESSAGE)).not.toBeInTheDocument();
  });
  it('po zmianie liczby osób z Kierunku usuwa stare oferty i wyszukuje dla nowej grupy', async () => {
    const fetch = mockFetch();
    const { rerender } = render(<StaySearch criteria={criteria()} />);
    clickSearch(); await quotes();
    rerender(<StaySearch criteria={{ ...criteria(), travelers: 3 }} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
    clickSearch(); await quotes();
    expect(JSON.parse(String(fetch.mock.calls[1][1].body)).adults).toBe(3);
    rerender(<StaySearch criteria={criteria()} />); await quotes();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('podpowiada parametry, wyszukuje dopiero po kliknięciu i pokazuje cenę całego pobytu z pochodzeniem', async () => {
    const fetch = mockFetch();
    render(<StaySearch criteria={criteria()} />);
    expect(screen.getByLabelText('Miasto noclegu')).toHaveValue('Paryż');
    expect(screen.getByLabelText('Zameldowanie')).toHaveValue(nextDate(7));
    expect(screen.getByLabelText('Wymeldowanie')).toHaveValue(nextDate(9));
    expect(screen.queryByLabelText('Liczba dorosłych')).not.toBeInTheDocument();
    expect(screen.getByText(/2 os. dorosłych · 1 pokój · liczba osób/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    clickSearch(); await quotes();
    expect(fetch.mock.calls[0][0]).toMatch(/\/stays\/search$/);
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual(stayCriteria());
    const region = screen.getByRole('region', { name: 'Noclegi OBO Travel' });
    expect(region).toHaveTextContent('800,00'); expect(region).toHaveTextContent('za cały pobyt · 2 os. dorosłych · 1 pokój');
    expect(region).toHaveTextContent('400,00'); expect(region).toHaveTextContent('Źródło ceny: OBO Travel');
    expect(region).toHaveTextContent('Brak potwierdzenia'); expect(region).toHaveTextContent('Dodatkowo płatne');
    expect(region).toHaveTextContent('Podatek miejski: 12,00'); expect(region).toHaveTextContent('at_property');
    expect(screen.getByRole('link', { name: 'Sprawdź ofertę w OBO' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(localStorage.length).toBe(0);
  });

  it('wymaga co najmniej jednej nocy i pozwala zmienić daty noclegu bez zmiany podróży', async () => {
    const fetch = mockFetch(); const trip = { ...criteria(), returnDate: nextDate(7) };
    render(<StaySearch criteria={trip} />); clickSearch();
    expect(screen.getByLabelText('Wymeldowanie')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Wymeldowanie')).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Wymeldowanie'), { target: { value: nextDate(8) } });
    clickSearch(); await quotes();
    expect(trip.returnDate).toBe(nextDate(7));
    expect(JSON.parse(String(fetch.mock.calls[0][1].body)).checkOut).toBe(nextDate(8));
  });

  it('pozwala na 30 nocy od zameldowania za 400 dni, odrzucając 31 nocy', async () => {
    const fetch = mockFetch();
    render(<StaySearch criteria={{ ...criteria(), departureDate: nextDate(400), returnDate: nextDate(431) }} />);
    clickSearch();
    expect(screen.getByLabelText('Wymeldowanie')).toHaveAttribute('aria-invalid', 'true');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Wymeldowanie'), { target: { value: nextDate(430) } });
    expect(screen.getByLabelText('Wymeldowanie')).toHaveAttribute('max', nextDate(430));
    clickSearch(); await quotes();
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toMatchObject({ checkIn: nextDate(400), checkOut: nextDate(430) });
  });

  it('usuwa wyniki po edycji pól i resetuje propozycję przy zmianie kontekstu podróży', async () => {
    const fetch = mockFetch();
    const { rerender } = render(<StaySearch criteria={criteria()} />); clickSearch(); await quotes();
    fireEvent.change(screen.getByLabelText('Miasto noclegu'), { target: { value: 'Paris' } });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
    rerender(<StaySearch criteria={{ ...criteria(), destination: 'Londyn', departureDate: nextDate(10), returnDate: nextDate(12) }} />);
    expect(screen.getByLabelText('Miasto noclegu')).toHaveValue('Londyn');
    expect(screen.getByLabelText('Zameldowanie')).toHaveValue(nextDate(10));
    expect(screen.queryByLabelText('Liczba dorosłych')).not.toBeInTheDocument();
    expect(screen.getByText(/2 os. dorosłych · 1 pokój · liczba osób/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('anuluje poprzednie wyszukanie i ignoruje odpowiedź przychodzącą po zmianie parametrów', async () => {
    let resolve: (value: Response) => void = () => {};
    const fetch = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>((done) => { resolve = done; })); vi.stubGlobal('fetch', fetch);
    const { rerender } = render(<StaySearch criteria={criteria()} />); clickSearch();
    const signal = fetch.mock.calls[0][1].signal;
    rerender(<StaySearch criteria={{ ...criteria(), destination: 'Amsterdam' }} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(json(result())));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('Hotel testowy')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Miasto noclegu')).toHaveValue('Amsterdam');
  });

  it('usuwa ceny i linki dokładnie po czasie expiresAt', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-11-14T10:00:00Z'); mockFetch();
    render(<StaySearch criteria={criteria()} />); clickSearch(); await settle();
    expect(screen.getByRole('link')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(60001));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('Hotel testowy')).not.toBeInTheDocument();
    expect(screen.getByText('Ceny wygasły. Sprawdź ponownie.')).toBeInTheDocument();
  });

  it('sprawdza ważność po wznowieniu karty i przed aktywacją linku', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-11-14T10:00:00Z'); mockFetch();
    render(<StaySearch criteria={criteria()} />); clickSearch(); await settle();
    const link = screen.getByRole('link');
    vi.setSystemTime('2026-11-14T10:02:00Z');
    expect(fireEvent.click(link)).toBe(false);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    clickSearch(); await settle(); expect(screen.getByRole('link')).toBeInTheDocument();
    vi.setSystemTime('2026-11-14T10:04:00Z');
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('zachowuje świeże oferty przy pagehide i odtwarza je po odmontowaniu bez pobierania', async () => {
    const fetch = mockFetch(); const { unmount } = render(<StaySearch criteria={criteria()} />); clickSearch(); await quotes();
    fireEvent(window, new Event('pagehide'));
    fireEvent(window, new Event('pageshow'));
    expect(screen.getByRole('link')).toBeInTheDocument();
    unmount(); render(<StaySearch criteria={criteria()} />); await quotes();
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByText('Hotel testowy')).toBeInTheDocument();
  });

  it.each(['https://onebookingonline.com.evil.test/hotel', 'https://evil@onebookingonline.com/hotel', 'http://onebookingonline.com/hotel', 'https://onebookingonline.com:8443/hotel', 'javascript:alert(1)'])('odrzuca link %s i nie interpretuje treści dostawcy jako HTML', async (bookingUrl) => {
    const response = result();
    response.hotels = [{ ...response.hotels[0], bookingUrl, name: '<img src=x onerror=alert(0)>', inclusionsNote: '<script>alert(1)</script>' }];
    mockFetch(response); const { container } = render(<StaySearch criteria={criteria()} />); clickSearch();
    await screen.findAllByText('Link do oferty jest niedostępny.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('script, img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(0)>')).toBeInTheDocument();
  });

  it('rozróżnia limit, brak ofert i awarię, przestrzegając czasu ponowienia', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-11-14T10:00:00Z');
    const fetch = mockFetch(result(stayCriteria(), { status: 'RATE_LIMITED', hotels: [], expiresAt: null, retryAfterSeconds: 2 }));
    render(<StaySearch criteria={criteria()} />); clickSearch(); await settle();
    expect(screen.getByText(STAYS_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sprawdź noclegi' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Miasto noclegu'), { target: { value: 'Paris' } });
    expect(screen.getByRole('button', { name: 'Sprawdź noclegi' })).toBeDisabled();
    await act(async () => vi.advanceTimersByTime(2001));
    fetch.mockImplementation(async (_url, init) => json(result(JSON.parse(String(init.body)) as StayCriteria, { status: 'EMPTY', hotels: [], expiresAt: null })));
    clickSearch(); await settle(); expect(screen.getByText(STAYS_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
    fetch.mockImplementation(async (_url, init) => json(result(JSON.parse(String(init.body)) as StayCriteria, { status: 'PROVIDER_ERROR', hotels: [], expiresAt: null })));
    clickSearch(); await settle(); expect(screen.getByText(STAYS_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });

  it('pokazuje błąd walidacji API i nie zostawia linków po wadliwej odpowiedzi', async () => {
    const fetch = vi.fn(async () => json({ detail: 'Zmień datę przyjazdu.' }, 400)); vi.stubGlobal('fetch', fetch);
    render(<StaySearch criteria={criteria()} />); clickSearch();
    expect(await screen.findByRole('alert')).toHaveTextContent(STAYS_UNAVAILABLE_MESSAGE);
    fetch.mockImplementation(async () => json({ ...result(), hotels: [{ ...result().hotels[0], expiresAt: 'niepoprawny czas' }] }));
    clickSearch(); expect(await screen.findByRole('alert')).toHaveTextContent(STAYS_UNAVAILABLE_MESSAGE);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('pokazuje jawnie niepotwierdzone miejsce płatności i tłumaczy znane oznaczenie property', async () => {
    const response = result();
    response.hotels[0].extraCharges = [
      { name: 'Opłata lokalna', amount: '10.00', currency: 'EUR', payableAt: null },
      { name: 'Podatek', amount: '20.00', currency: 'EUR', payableAt: 'property' },
    ];
    mockFetch(response); render(<StaySearch criteria={criteria()} />); clickSearch(); await quotes();
    expect(screen.getByText(/Miejsce płatności niepotwierdzone/)).toBeInTheDocument();
    expect(screen.getByText(/płatne w obiekcie/)).toBeInTheDocument();
  });

  it('przerywa żądanie po 30 sekundach i po odmontowaniu', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-11-14T10:00:00Z');
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })); vi.stubGlobal('fetch', fetch);
    const { unmount } = render(<StaySearch criteria={criteria()} />); clickSearch();
    await act(async () => vi.advanceTimersByTime(30001));
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent(STAYS_UNAVAILABLE_MESSAGE);
    clickSearch(); unmount();
    expect(fetch.mock.calls[1][1].signal?.aborted).toBe(true);
    await settle();
  });

  it('nie pobiera ponownie świeżych ofert po identycznym wyszukiwaniu i przywraca ostatnią formę', async () => {
    const fetch = mockFetch(); const { unmount } = render(<StaySearch criteria={criteria()} />);
    fireEvent.change(screen.getByLabelText('Miasto noclegu'), { target: { value: 'Paris' } });
    clickSearch(); await quotes(); clickSearch(); await quotes();
    expect(fetch).toHaveBeenCalledOnce();
    unmount(); render(<StaySearch criteria={criteria()} />); await quotes();
    expect(screen.getByLabelText('Miasto noclegu')).toHaveValue('Paris');
    expect(fetch).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Miasto noclegu'), { target: { value: 'Paryż' } });
    clickSearch(); await quotes(); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('pokazuje dozwolone zdjęcie bez przekształceń i placeholder po błędzie, przekazując hotele do mapy', async () => {
    const response = result();
    response.hotels[0].photoUrl = 'https://onebookingonline.com/photos/hotel.jpg?size=original';
    response.hotels[0].location = { latitude: 48.86, longitude: 2.34 };
    mockFetch(response); const onHotelsChange = vi.fn(); const onShowHotel = vi.fn();
    const { rerender } = render(<StaySearch criteria={criteria()} onHotelsChange={onHotelsChange} onShowHotel={onShowHotel} />);
    clickSearch(); await quotes();
    expect(onHotelsChange).toHaveBeenLastCalledWith(response.hotels);
    const image = screen.getByRole('img', { name: 'Zdjęcie hotelu Hotel testowy' });
    expect(image).toHaveAttribute('src', response.hotels[0].photoUrl);
    expect(image).toHaveAttribute('loading', 'lazy'); expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż na mapie' }));
    expect(onShowHotel).toHaveBeenCalledWith('opaque-quote');
    fireEvent.error(image); expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Zdjęcie niedostępne')).toBeInTheDocument();
    rerender(<StaySearch criteria={{ ...criteria(), destination: 'Amsterdam' }} onHotelsChange={onHotelsChange} onShowHotel={onShowHotel} />);
    expect(onHotelsChange).toHaveBeenLastCalledWith([]);
  });

  it('nie ładuje zdjęć spoza OBO i nie udostępnia przycisku mapy bez współrzędnych', async () => {
    const response = result(); response.hotels[0].photoUrl = 'https://onebookingonline.com.evil.test/photo.jpg';
    const fetch = mockFetch(response); const { unmount } = render(<StaySearch criteria={criteria()} onShowHotel={vi.fn()} />);
    clickSearch(); await quotes();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Zdjęcie niedostępne')).toBeInTheDocument();
    expect(screen.getByText('Lokalizacja hotelu niedostępna.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pokaż na mapie' })).not.toBeInTheDocument();
    unmount(); render(<StaySearch criteria={criteria()} onShowHotel={vi.fn()} />); await quotes();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('pozostawia świeże wyniki w pamięci przy zablokowanym sessionStorage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    const fetch = mockFetch(); render(<StaySearch criteria={criteria()} />);
    clickSearch(); await quotes(); clickSearch(); await quotes();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('usuwa również punkty mapy po wygaśnięciu zapamiętanych ofert', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-11-14T10:00:00Z'); mockFetch(); const callback = vi.fn();
    render(<StaySearch criteria={criteria()} onHotelsChange={callback} />);
    clickSearch(); await settle();
    expect(callback.mock.lastCall?.[0]).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(60001));
    expect(callback).toHaveBeenLastCalledWith([]);
  });

  it('przerywa oczekujące pobieranie przy pagehide bez zapisania spóźnionego wyniku', async () => {
    let resolve: (value: Response) => void = () => {};
    const fetch = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>((done) => { resolve = done; })); vi.stubGlobal('fetch', fetch);
    render(<StaySearch criteria={criteria()} />); clickSearch();
    fireEvent(window, new Event('pagehide'));
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    await act(async () => resolve(json(result())));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('w trybie kompaktowym stronicuje po jednym hotelu i wybiera nocleg bez dodatkowych zapytań', async () => {
    const response = result();
    response.hotels = [0, 1, 2].map((index) => ({ ...response.hotels[0], hotelToken: `hotel-${index}`, name: `Hotel ${index + 1}` }));
    const fetch = mockFetch(response); const onSelectHotel = vi.fn();
    const { rerender } = render(<StaySearch criteria={criteria()} compact onSelectHotel={onSelectHotel} />);
    clickSearch(); await quotes();
    expect(screen.getByText('Nocleg 1 z 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Poprzedni nocleg' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: /Hotel 2/ })).not.toBeInTheDocument();
    const details = screen.getByText('Szczegóły ceny i opłat').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Szczegóły ceny i opłat'));
    expect(details).toHaveAttribute('open');
    expect(within(details).getByText('Dodatkowo płatne')).toBeInTheDocument();
    expect(within(details).getByText(/Źródło ceny: OBO Travel/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Następny nocleg' }));
    expect(screen.getByText('Nocleg 2 z 3')).toBeInTheDocument();
    const choose = screen.getByRole('button', { name: 'Wybierz nocleg' });
    expect(choose).toHaveAttribute('aria-pressed', 'false'); fireEvent.click(choose);
    expect(onSelectHotel).toHaveBeenCalledWith('hotel-1');
    rerender(<StaySearch criteria={criteria()} compact onSelectHotel={onSelectHotel} selectedHotelToken="hotel-1" />);
    expect(screen.getByRole('button', { name: 'Wybrany nocleg' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Następny nocleg' }));
    expect(screen.getByText('Nocleg 3 z 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Następny nocleg' })).toBeDisabled();
    const searchControls = screen.getByText('Parametry noclegu').closest('details')!;
    expect(searchControls).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Parametry noclegu'));
    clickSearch(); await quotes();
    expect(screen.getByText('Nocleg 2 z 3')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('ukrycie przez HTML hidden zachowuje cache i aktywny czas wygaśnięcia bez nowej sieci', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-11-14T10:00:00Z');
    const fetch = mockFetch(); const onHotelsChange = vi.fn(); const onSelectHotel = vi.fn();
    const content = (hidden: boolean) => <div hidden={hidden}><StaySearch criteria={criteria()} compact onHotelsChange={onHotelsChange} onSelectHotel={onSelectHotel} /></div>;
    const { rerender } = render(content(false)); clickSearch(); await settle();
    rerender(content(true));
    await act(async () => vi.advanceTimersByTime(60001));
    rerender(content(false));
    expect(screen.queryByRole('button', { name: 'Wybierz nocleg' })).not.toBeInTheDocument();
    expect(screen.getByText('Ceny wygasły. Sprawdź ponownie.')).toBeInTheDocument();
    expect(onHotelsChange).toHaveBeenLastCalledWith([]);
    expect(fetch).toHaveBeenCalledOnce(); expect(onSelectHotel).not.toHaveBeenCalled();
  });
});
