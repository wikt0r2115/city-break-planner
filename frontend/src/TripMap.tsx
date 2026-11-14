import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Map as TilerMap, Marker, Popup, GeoJSONSource } from '@maptiler/sdk';
import type { Attraction, Place, Plan, StayHotel } from './types';
import { moment, money } from './format';
import { loadMapSdk } from './mapSdk';

type Coordinates = [number, number];
type MapPoint = { id: string; name: string; coordinates: Coordinates | null; number?: number; details: string; conflict: boolean; hotelToken?: string };
type Sdk = Awaited<ReturnType<typeof loadMapSdk>>;
const noAttractions: Attraction[] = [];
const noHotels: StayHotel[] = [];

function coordinates(place?: Place | null): Coordinates | null {
  const longitude = place?.longitude;
  const latitude = place?.latitude;
  return typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    ? [longitude, latitude] : null;
}

function mapPoints(plan: Plan, attractions: Attraction[]) {
  const zone = plan.selectedRoundTrip.outbound.segments.at(-1)?.destination.timeZone;
  const visits: MapPoint[] = plan.items.map((item, index) => ({
    id: item.id, name: item.name, number: index + 1,
    coordinates: coordinates(item.location ?? attractions.find((attraction) => attraction.id === item.attractionId)?.location),
    conflict: item.conflicts.length > 0,
    details: `${moment(item.startsAt, item.location?.timeZone ?? zone)} — ${moment(item.endsAt, item.location?.timeZone ?? zone)}${item.conflicts.length ? `. Konflikt: ${item.conflicts.map((conflict) => conflict.reason).join(' ')}` : ''}`,
  }));
  const stops: MapPoint[] = [];
  const seen = new Set<string>();
  for (const segment of [...plan.selectedRoundTrip.outbound.segments, ...plan.selectedRoundTrip.returnJourney.segments]) {
    for (const place of [segment.origin, segment.destination]) {
      const position = coordinates(place);
      if (!position) continue;
      const key = `${place.name}/${position.join('/')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stops.push({ id: `stop-${key}`, name: place.name, coordinates: position, conflict: false, details: 'Punkt wybranej podróży' });
    }
  }
  return { visits, stops };
}

function fitPoints(map: TilerMap, points: MapPoint[], sdk: Sdk) {
  const positions = points.flatMap((point) => point.coordinates ? [point.coordinates] : []);
  if (!positions.length) return;
  const bounds = new sdk.LngLatBounds(positions[0], positions[0]);
  positions.slice(1).forEach((position) => bounds.extend(position));
  map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
}

export function TripMap({ plan, attractions = noAttractions, hotels = noHotels, selectedHotelToken = null, hotelFocusRequest = 0, viewKey }: {
  plan: Plan; attractions?: Attraction[]; hotels?: StayHotel[]; selectedHotelToken?: string | null; hotelFocusRequest?: number; viewKey?: string;
}) {
  const key = (import.meta.env.VITE_MAPTILER_API_KEY ?? '').trim();
  const titleId = useId();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<TilerMap | null>(null);
  const sdkRef = useRef<Sdk | null>(null);
  const markers = useRef<Marker[]>([]);
  const popup = useRef<Popup | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<'visits' | 'trip' | 'hotels'>('visits');
  const { visits, stops } = useMemo(() => mapPoints(plan, attractions), [plan, attractions]);
  const hotelPoints: MapPoint[] = useMemo(() => {
    const quotes: MapPoint[] = hotels.map((hotel) => ({
    id: `hotel-${hotel.hotelToken}`, hotelToken: hotel.hotelToken, name: hotel.name,
    coordinates: hotel.location ? coordinates({ ...hotel.location, name: hotel.name }) : null,
    conflict: false,
    details: `${money(hotel.totalPrice, hotel.currency)} za cały pobyt · OBO Travel · Wycena: ${moment(hotel.quotedAt)}`,
    }));
    const base = plan.lodging;
    if (base && coordinates(base) && !quotes.some((point) => point.name === base.name
      && point.coordinates?.[0] === base.longitude && point.coordinates?.[1] === base.latitude)) {
      quotes.push({ id: 'lodging-base', hotelToken: 'lodging-base', name: base.name,
        coordinates: coordinates(base), conflict: false,
        details: 'Wybrany nocleg · punkt startu zwiedzania. Dojście do atrakcji jest szacunkowe.' });
    }
    return quotes;
  }, [hotels, plan.lodging]);

  useEffect(() => {
    if (hotelPoints.some((point) => point.coordinates)) setView('hotels');
    else setView((current) => current === 'hotels' ? 'visits' : current);
  }, [hotelPoints]);

  useEffect(() => {
    if (!key || !container.current) return;
    let cancelled = false;
    let instance: TilerMap | null = null;
    setStatus('loading');
    const timeout = window.setTimeout(() => { if (!cancelled) setStatus('error'); }, 15000);
    void loadMapSdk().then((sdk) => {
      if (cancelled || !container.current) return;
      sdk.config.apiKey = key;
      sdk.config.telemetry = false;
      sdk.config.session = true;
      const destination = plan.selectedRoundTrip.outbound.segments.at(-1)?.destination;
      instance = new sdk.Map({
        container: container.current,
        style: sdk.MapStyle.STREETS,
        center: coordinates(destination) ?? [10, 50], zoom: 10,
        geolocate: false, geolocateControl: false, maptilerLogo: true,
      });
      mapRef.current = instance;
      sdkRef.current = sdk;
      instance.on('load', () => {
        if (cancelled) return;
        window.clearTimeout(timeout);
        setStatus('ready');
      });
      instance.on('error', () => {
        if (!cancelled) { window.clearTimeout(timeout); setStatus('error'); }
      });
    }).catch(() => {
      if (!cancelled) { window.clearTimeout(timeout); setStatus('error'); }
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      popup.current?.remove(); popup.current = null;
      markers.current.forEach((marker) => marker.remove()); markers.current = [];
      instance?.remove();
      if (mapRef.current === instance) { mapRef.current = null; sdkRef.current = null; }
    };
    // The renderer survives plan changes; markers and bounds update below.
  }, [key, attempt]);

  function showPoint(point: MapPoint) {
    const map = mapRef.current;
    const sdk = sdkRef.current;
    if (!map || !sdk || !point.coordinates) return;
    popup.current?.remove();
    const content = document.createElement('div');
    const heading = document.createElement('strong'); heading.textContent = point.number ? `${point.number}. ${point.name}` : point.name;
    const description = document.createElement('p'); description.textContent = point.details;
    content.append(heading, description);
    popup.current = new sdk.Popup({ maxWidth: '280px' }).setLngLat(point.coordinates).setDOMContent(content).addTo(map);
    map.easeTo({ center: point.coordinates, zoom: Math.max(map.getZoom(), 12), duration: 0 });
  }

  useEffect(() => {
    if (viewKey !== undefined && status === 'ready') mapRef.current?.resize();
  }, [viewKey, status]);

  useEffect(() => {
    const map = mapRef.current;
    const sdk = sdkRef.current;
    if (status !== 'ready' || !map || !sdk) return;
    const orderedPoints = plan.lodging ? [{ coordinates: coordinates(plan.lodging) }, ...visits] : visits;
    const order = {
      type: 'FeatureCollection' as const,
      features: orderedPoints.slice(1).flatMap((point, index) => {
        const previous = orderedPoints[index].coordinates;
        return previous && point.coordinates ? [{
          type: 'Feature' as const, properties: {},
          geometry: { type: 'LineString' as const, coordinates: [previous, point.coordinates] },
        }] : [];
      }),
    };
    const source = map.getSource('visit-order');
    if (source) (source as GeoJSONSource).setData(order);
    else {
      map.addSource('visit-order', { type: 'geojson', data: order });
      map.addLayer({ id: 'visit-order-line', type: 'line', source: 'visit-order', paint: {
        'line-color': '#294a3f', 'line-width': 3, 'line-dasharray': [2, 2],
      } });
    }
    popup.current?.remove(); popup.current = null;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    for (const point of [...stops, ...visits, ...hotelPoints]) {
      if (!point.coordinates) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `trip-map-marker ${point.hotelToken ? 'hotel-marker' : point.number ? 'visit-marker' : 'stop-marker'}${point.conflict ? ' conflict-marker' : ''}`;
      button.textContent = point.hotelToken ? 'H' : point.number ? String(point.number) : '●';
      button.setAttribute('aria-label', `${point.hotelToken ? 'Nocleg: ' : point.number ? `${point.number}. ` : 'Przystanek: '}${point.name}${point.conflict ? ' — konflikt w planie' : ''}`);
      button.addEventListener('click', (event) => {
        // A newly opened popup must not receive this click again as a map click.
        event.stopPropagation();
        showPoint(point);
      });
      markers.current.push(new sdk.Marker({ element: button, anchor: 'center' }).setLngLat(point.coordinates).addTo(map));
    }
    const local = visits.filter((point) => point.coordinates);
    const destination = plan.selectedRoundTrip.outbound.segments.at(-1)?.destination;
    const arrival = stops.find((stop) => stop.name === destination?.name);
    fitPoints(map, view === 'trip' ? [...stops, ...visits, ...hotelPoints]
      : view === 'hotels' ? [...visits, ...hotelPoints] : local.length ? local : arrival ? [arrival] : stops, sdk);
  }, [visits, stops, hotelPoints, status, view, plan.selectedRoundTrip, plan.lodging]);

  useEffect(() => {
    if (status !== 'ready' || !selectedHotelToken) return;
    const point = hotelPoints.find((hotel) => hotel.hotelToken === selectedHotelToken);
    if (point) showPoint(point);
  }, [selectedHotelToken, hotelFocusRequest, hotelPoints, status]);

  const missing = visits.filter((point) => !point.coordinates).length;
  return <section className="panel trip-map-panel" aria-labelledby={titleId}>
    <div className="section-heading"><div><p className="eyebrow">TWÓJ PLAN NA MAPIE</p><h3 id={titleId}>Zobacz, gdzie jedziesz</h3></div>
      {key && status === 'ready' && <div className="trip-map-views" aria-label="Zasięg mapy">
        <button type="button" aria-pressed={view === 'visits'} onClick={() => setView('visits')}>Zwiedzanie</button>
        <button type="button" aria-pressed={view === 'trip'} onClick={() => setView('trip')}>Cała podróż</button>
        {hotelPoints.some((point) => point.coordinates) && <button type="button" aria-pressed={view === 'hotels'} onClick={() => setView('hotels')}>Noclegi</button>}
      </div>}
    </div>
    {!key ? <p className="empty-note" role="status">Mapa nie została jeszcze skonfigurowana. Wszystkie miejsca i godziny znajdziesz w harmonogramie.</p> : <>
      <div className="trip-map-frame">
        <div className="trip-map-canvas" ref={container} aria-label="Interaktywna mapa podróży i atrakcji" />
        {status === 'loading' && <p className="trip-map-message" role="status">Wczytujemy mapę…</p>}
      </div>
      {status === 'error' && <div className="trip-map-error" role="alert"><p>Nie udało się wczytać mapy. Sprawdź połączenie z internetem lub spróbuj ponownie. Harmonogram nadal jest dostępny.</p><button type="button" className="secondary-button" onClick={() => setAttempt((value) => value + 1)}>Ponów wczytanie mapy</button></div>}
    </>}
    <p className="trip-map-legend"><span><i className="visit-swatch" aria-hidden="true" /> Numer: kolejność zwiedzania</span><span><i className="conflict-swatch" aria-hidden="true" /> Czerwony: konflikt w planie</span><span><i className="stop-swatch" aria-hidden="true" /> Punkt podróży</span>{hotelPoints.length > 0 && <span><i className="hotel-swatch" aria-hidden="true" /> H: wybrany nocleg lub oferta OBO Travel</span>}</p>
    <p className="muted">Linia pokazuje kolejność zwiedzania, nie rzeczywistą trasę ani czas dojścia.</p>
    {plan.testData && <p className="muted">Przystanki i atrakcje pochodzą z danych demonstracyjnych.</p>}
    {missing > 0 && <p className="muted">Atrakcje bez znanej lokalizacji: {missing}. Pozostają w harmonogramie.</p>}
    {visits.length === 0 && <p className="muted">Dodaj atrakcje do planu, aby zobaczyć je na mapie.</p>}
    {key && visits.length > 0 && <details className="trip-map-points"><summary>Atrakcje na mapie ({visits.length})</summary><ol>{visits.map((point) => <li key={point.id} value={point.number}>
      {point.coordinates && status === 'ready' ? <button type="button" className="text-button" onClick={() => showPoint(point)}>{point.name} — pokaż na mapie</button> : <strong>{point.name}</strong>}
      <p>{point.details}{!point.coordinates ? ' · Lokalizacja niedostępna.' : ''}</p>
    </li>)}</ol></details>}
    {hotelPoints.length > 0 && <details className="trip-map-points"><summary>Noclegi na mapie ({hotelPoints.length})</summary><ul>{hotelPoints.map((point) => <li key={point.id}>
      {point.coordinates && key && status === 'ready' ? <button type="button" className="text-button" onClick={() => showPoint(point)}>{point.name} — pokaż nocleg na mapie</button> : <strong>{point.name}</strong>}
      <p>{point.details}{!point.coordinates ? ' · Lokalizacja niedostępna.' : ''}</p>
    </li>)}</ul></details>}
  </section>;
}
