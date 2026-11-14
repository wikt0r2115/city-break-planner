import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TripMap } from './TripMap';
import { loadMapSdk } from './mapSdk';
import { planFor } from './test/fixtures';
import type { Plan, PlanItem, StayHotel } from './types';

const fake = vi.hoisted(() => ({
  maps: [] as { options: Record<string, unknown>; handlers: Record<string, () => void>; remove: ReturnType<typeof vi.fn>; easeTo: ReturnType<typeof vi.fn>; fitBounds: ReturnType<typeof vi.fn>; source: { setData: ReturnType<typeof vi.fn> } | null; addSource: ReturnType<typeof vi.fn>; addLayer: ReturnType<typeof vi.fn> }[],
  markers: [] as { element: HTMLButtonElement; position: number[]; remove: ReturnType<typeof vi.fn> }[],
  popupContents: [] as HTMLElement[],
  throwOnMap: false,
}));
vi.mock('./mapSdk', () => ({ loadMapSdk: vi.fn() }));

const sdk = {
  config: { apiKey: '', telemetry: true, session: true },
  MapStyle: { STREETS: 'test-style' },
  Map: class {
    options: Record<string, unknown>;
    handlers: Record<string, () => void> = {};
    remove = vi.fn(); easeTo = vi.fn(); fitBounds = vi.fn(); resize = vi.fn();
    source: { setData: ReturnType<typeof vi.fn> } | null = null;
    constructor(options: Record<string, unknown>) {
      if (fake.throwOnMap) throw new Error('WebGL is not available');
      this.options = options; fake.maps.push(this);
    }
    on(name: string, callback: () => void) { this.handlers[name] = callback; }
    getSource() { return this.source; }
    addSource = vi.fn(() => { this.source = { setData: vi.fn() }; });
    addLayer = vi.fn();
    getZoom() { return 10; }
  },
  Marker: class {
    element: HTMLButtonElement; position: number[] = [];
    constructor({ element }: { element: HTMLButtonElement }) { this.element = element; fake.markers.push(this); }
    setLngLat(position: number[]) { this.position = position; return this; }
    addTo(map: { options: Record<string, unknown> }) { (map.options.container as HTMLElement).append(this.element); return this; }
    remove = vi.fn(() => this.element.remove());
  },
  Popup: class {
    setLngLat() { return this; }
    setDOMContent(content: HTMLElement) { fake.popupContents.push(content); return this; }
    addTo() { return this; }
    remove() {}
  },
  LngLatBounds: class { extend() { return this; } },
};

function visit(id: string, latitude = 48.86, longitude = 2.33): PlanItem {
  return { ...planFor().items[0], id, attractionId: id, name: id, location: { name: id, latitude, longitude }, conflicts: [] };
}
function plan(items = [visit('Luwr'), visit('Park', 48.85, 2.34)]): Plan {
  return { ...planFor(), items };
}
async function loaded() {
  await waitFor(() => expect(fake.maps).toHaveLength(1));
  act(() => fake.maps[0].handlers.load());
  await screen.findByRole('button', { name: 'Zwiedzanie' });
}

beforeEach(() => {
  vi.stubEnv('VITE_MAPTILER_API_KEY', 'test-public-map-key');
  fake.maps.length = 0; fake.markers.length = 0; fake.popupContents.length = 0; fake.throwOnMap = false;
  vi.mocked(loadMapSdk).mockReset().mockResolvedValue(sdk as unknown as Awaited<ReturnType<typeof loadMapSdk>>);
});
afterEach(() => vi.unstubAllEnvs());

describe('mapa wybranego planu', () => {
  it('nie pobiera SDK bez klucza i zachowuje czytelny harmonogram', async () => {
    vi.stubEnv('VITE_MAPTILER_API_KEY', '');
    render(<TripMap plan={plan()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Mapa nie została jeszcze skonfigurowana');
    expect(loadMapSdk).not.toHaveBeenCalled();
  });

  it('aktualizuje kolejność, konflikty i linię bez tworzenia nowej sesji mapy', async () => {
    const first = visit('Luwr'); const second = visit('Park', 48.85, 2.34);
    const { rerender, unmount } = render(<TripMap plan={plan([first, second])} />);
    expect(screen.getByRole('status')).toHaveTextContent('Wczytujemy mapę');
    await loaded();
    expect(fake.maps[0].options).toMatchObject({ geolocate: false, geolocateControl: false, maptilerLogo: true });
    expect(sdk.config).toMatchObject({ telemetry: false, session: true });
    expect(screen.getByRole('button', { name: '1. Luwr' })).toBeInTheDocument();
    const oldMarkers = [...fake.markers];
    const conflict = { code: 'RETURN_DEPARTURE', reason: 'Wizyta po odjeździe.', itemId: second.id };
    rerender(<TripMap plan={plan([{ ...second, conflicts: [conflict] }, first])} />);
    expect(fake.maps).toHaveLength(1);
    expect(loadMapSdk).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '1. Park — konflikt w planie' })).toHaveClass('conflict-marker');
    expect(screen.getByRole('button', { name: '2. Luwr' })).toBeInTheDocument();
    expect(oldMarkers.every((marker) => marker.remove.mock.calls.length === 1)).toBe(true);
    expect(fake.maps[0].source?.setData).toHaveBeenLastCalledWith(expect.objectContaining({ features: [expect.objectContaining({ geometry: { type: 'LineString', coordinates: [[2.34, 48.85], [2.33, 48.86]] } })] }));
    fireEvent.click(screen.getByRole('button', { name: '1. Park — konflikt w planie' }));
    expect(fake.popupContents[0].textContent).toContain('Wizyta po odjeździe.');
    unmount();
    expect(fake.maps[0].remove).toHaveBeenCalledOnce();
    expect(fake.markers.every((marker) => marker.remove.mock.calls.length > 0)).toBe(true);
  });

  it('nie rysuje błędnych współrzędnych ani linii przez brakującą lokalizację', async () => {
    const unknown = { ...visit('Nieznane'), location: null };
    render(<TripMap plan={plan([visit('Luwr'), unknown, visit('Park'), visit('Błędne', 91), visit('NaN', Number.NaN)])} />);
    await loaded();
    expect(fake.markers).toHaveLength(2);
    expect(screen.getByText('Atrakcje bez znanej lokalizacji: 3. Pozostają w harmonogramie.')).toBeInTheDocument();
    expect(fake.maps[0].addSource).toHaveBeenCalledWith('visit-order', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  });

  it('traktuje nazwy i powody konfliktów jako tekst, także w popupie', async () => {
    render(<TripMap plan={plan([visit('<img src=x onerror=alert(1)>')])} />);
    await loaded();
    const mapClick = vi.fn();
    const canvas = screen.getByLabelText('Interaktywna mapa podróży i atrakcji');
    canvas.addEventListener('click', mapClick);
    fireEvent.click(screen.getByRole('button', { name: '1. <img src=x onerror=alert(1)>' }));
    expect(mapClick).not.toHaveBeenCalled();
    expect(fake.popupContents[0].querySelector('img')).toBeNull();
    expect(fake.popupContents[0].textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('po błędzie dostawcy umożliwia ponowienie i usuwa poprzednią instancję', async () => {
    render(<TripMap plan={plan()} />);
    await loaded();
    act(() => fake.maps[0].handlers.error());
    expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się wczytać mapy');
    fireEvent.click(screen.getByRole('button', { name: 'Ponów wczytanie mapy' }));
    await waitFor(() => expect(fake.maps).toHaveLength(2));
    expect(fake.maps[0].remove).toHaveBeenCalledOnce();
    act(() => fake.maps[1].handlers.load());
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('pokazuje błąd przy niedostępnym WebGL, zachowując listę miejsc', async () => {
    fake.throwOnMap = true;
    render(<TripMap plan={plan()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Harmonogram nadal jest dostępny');
    expect(screen.getByText('Atrakcje na mapie (2)')).toBeInTheDocument();
  });

  it('nie tworzy mapy po odmontowaniu podczas pobierania SDK', async () => {
    let resolve: (value: Awaited<ReturnType<typeof loadMapSdk>>) => void = () => {};
    vi.mocked(loadMapSdk).mockReturnValue(new Promise((done) => { resolve = done; }));
    const { unmount } = render(<TripMap plan={plan()} />);
    unmount();
    await act(async () => resolve(sdk as unknown as Awaited<ReturnType<typeof loadMapSdk>>));
    expect(fake.maps).toHaveLength(0);
  });

  it('pokazuje i usuwa hotele bez nowej instancji, a wybór karty otwiera bezpieczny popup', async () => {
    const hotel: StayHotel = { hotelToken: 'obo-test', name: '<img src=x onerror=alert(1)>', stars: 3,
      totalPrice: '200.00', nightlyPrice: '100.00', currency: 'PLN', bookingUrl: 'https://onebookingonline.com/hotel/test',
      taxesIncluded: null, feesIncluded: null, extraCharges: [], inclusionsNote: null,
      quotedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
      photoUrl: null, location: { latitude: 48.88, longitude: 2.3 } };
    const { rerender } = render(<TripMap plan={plan()} hotels={[hotel]} />);
    await loaded();
    expect(screen.getByRole('button', { name: `Nocleg: ${hotel.name}` })).toHaveClass('hotel-marker');
    expect(screen.getByRole('button', { name: 'Noclegi' })).toHaveAttribute('aria-pressed', 'true');
    rerender(<TripMap plan={plan()} hotels={[hotel]} selectedHotelToken={hotel.hotelToken} hotelFocusRequest={1} />);
    await waitFor(() => expect(fake.popupContents.length).toBeGreaterThan(0));
    expect(fake.popupContents.at(-1)?.querySelector('img')).toBeNull();
    expect(fake.popupContents.at(-1)?.textContent).toContain(hotel.name);
    expect(fake.maps[0].easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [2.3, 48.88] }));
    const count = fake.popupContents.length;
    rerender(<TripMap plan={plan()} hotels={[hotel]} selectedHotelToken={hotel.hotelToken} hotelFocusRequest={2} />);
    expect(fake.popupContents.length).toBeGreaterThan(count);
    rerender(<TripMap plan={plan()} hotels={[]} />);
    expect(screen.queryByRole('button', { name: `Nocleg: ${hotel.name}` })).not.toBeInTheDocument();
    expect(fake.maps).toHaveLength(1);
  });
});
