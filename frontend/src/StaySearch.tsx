import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { searchStays } from './api';
import { money, moment, nextDate } from './format';
import type { Criteria, StayCriteria, StayHotel, StayResult } from './types';
import { purgeStaySession, readCachedStay, readStaySession, rememberStayForm, rememberStayResult, removeCachedStay, stayExpiry } from './staySessionCache';
import { travelContext } from './plannerFlow';

const initialStay = (criteria: Criteria): StayCriteria => ({ destination: criteria.destination, checkIn: criteria.departureDate, checkOut: criteria.returnDate, adults: criteria.travelers ?? 1, currency: 'PLN', rooms: 1 });
const dateValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function errorsFor(form: StayCriteria): Partial<Record<keyof StayCriteria, string>> {
  const errors: Partial<Record<keyof StayCriteria, string>> = {};
  if (!form.destination.trim() || form.destination.trim().length > 120) errors.destination = 'Wpisz miasto noclegu (do 120 znaków).';
  if (!dateValue(form.checkIn) || form.checkIn < nextDate(1) || form.checkIn > nextDate(400)) errors.checkIn = 'Wybierz przyjazd od jutra, w ciągu najbliższych 400 dni.';
  if (!dateValue(form.checkOut) || form.checkOut <= form.checkIn) errors.checkOut = 'Wyjazd musi wypadać po przyjeździe.';
  else if ((Date.parse(form.checkOut) - Date.parse(form.checkIn)) / 86400000 > 30) errors.checkOut = 'Wybierz pobyt do 30 nocy.';
  if (!Number.isInteger(form.adults) || form.adults < 1 || form.adults > 8) errors.adults = 'Wybierz od 1 do 8 osób dorosłych.';
  if (!Number.isInteger(form.rooms ?? 1) || (form.rooms ?? 1) < 1 || (form.rooms ?? 1) > form.adults) errors.rooms = 'Wybierz od 1 pokoju do liczby osób dorosłych.';
  return errors;
}

function oboBookingUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['onebookingonline.com', 'www.onebookingonline.com'].includes(url.hostname)
      && !url.username && !url.password && !url.port ? value : undefined;
  } catch { return undefined; }
}

export const STAYS_UNAVAILABLE_MESSAGE = 'Poszukaj noclegu na własną rękę — nasi partnerzy są w tej chwili niedostępni.';
const roomsText = (count: number) => `${count} ${count === 1 ? 'pokój' : count < 5 ? 'pokoje' : 'pokoi'}`;

function HotelPhoto({ hotel }: { hotel: StayHotel }) {
  const photoUrl = hotel.photoUrl ? oboBookingUrl(hotel.photoUrl) : undefined;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  return photoUrl && !failed
    ? <img className="stay-photo" src={photoUrl} alt={`Zdjęcie hotelu ${hotel.name}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <div className="stay-photo-placeholder">Zdjęcie niedostępne</div>;
}

function hasLocation(hotel: StayHotel) {
  return hotel.location && Number.isFinite(hotel.location.latitude) && Math.abs(hotel.location.latitude) <= 90
    && Number.isFinite(hotel.location.longitude) && Math.abs(hotel.location.longitude) <= 180;
}

export function StaySearch({ criteria, onHotelsChange, onShowHotel, selectedHotelToken = null, onSelectHotel, disabled = false, onCriteriaChange }: {
  criteria: Criteria; onHotelsChange?: (hotels: StayHotel[]) => void; onShowHotel?: (hotelToken: string) => void;
  selectedHotelToken?: string | null; onSelectHotel?: (hotelToken: string) => void; disabled?: boolean; onCriteriaChange?: () => void;
}) {
  const id = useId();
  const context = travelContext(criteria);
  const [form, setForm] = useState<StayCriteria>(() => initialStay(criteria));
  const [errors, setErrors] = useState<Partial<Record<keyof StayCriteria, string>>>({});
  const [result, setResult] = useState<StayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [hotelPage, setHotelPage] = useState(0);
  const searchControls = useRef<HTMLDetailsElement>(null);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const currentResult = useRef<StayResult | null>(result);
  currentResult.current = result;
  const contextRef = useRef(context); contextRef.current = context;
  const hotelsCallback = useRef(onHotelsChange); hotelsCallback.current = onHotelsChange;

  function publish(response: StayResult | null) { currentResult.current = response; setResult(response); setHotelPage(0); hotelsCallback.current?.(response?.hotels ?? []); }
  useEffect(() => {
    if (searchControls.current) searchControls.current.open = !result?.hotels.length;
  }, [result]);
  function invalidate() { generation.current++; active.current?.abort(); active.current = null; setBusy(false); publish(null); }
  function expire() {
    const quoted = currentResult.current;
    if (quoted) removeCachedStay(contextRef.current, quoted.criteria);
    invalidate(); setExpired(true);
  }
  useEffect(() => {
    invalidate();
    const restored = readStaySession(context, initialStay(criteria));
    const synchronizedForm = { ...restored.criteria, adults: criteria.travelers ?? 1, rooms: restored.criteria.rooms ?? 1 };
    setForm(synchronizedForm); setErrors({}); setError(''); setExpired(restored.expired);
    publish(restored.result?.criteria.adults === synchronizedForm.adults ? restored.result : null);
    return () => { generation.current++; active.current?.abort(); hotelsCallback.current?.([]); };
    // Dates are editable suggestions; reset them only when the travel context changes.
  }, [context]);

  useEffect(() => {
    const checkExpiry = () => {
      purgeStaySession();
      const quoted = currentResult.current;
      const expiry = quoted && stayExpiry(quoted);
      if (quoted?.hotels.length && (expiry === null || !Number.isFinite(expiry) || expiry <= Date.now())) expire();
    };
    const pagehide = () => { generation.current++; active.current?.abort(); active.current = null; setBusy(false); checkExpiry(); };
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', checkExpiry);
    window.addEventListener('focus', checkExpiry);
    document.addEventListener('visibilitychange', checkExpiry);
    return () => { window.removeEventListener('pagehide', pagehide); window.removeEventListener('pageshow', checkExpiry); window.removeEventListener('focus', checkExpiry); document.removeEventListener('visibilitychange', checkExpiry); };
  }, []);

  const deadline = result ? stayExpiry(result) : null;
  const quoteIsCurrent = result !== null && (!result.hotels.length || deadline !== null && Number.isFinite(deadline) && deadline > Date.now());
  useEffect(() => {
    if (!result?.hotels.length || deadline === null) return;
    if (deadline <= Date.now()) { expire(); return; }
    const timer = window.setTimeout(expire, Math.min(deadline - Date.now(), 2147483647));
    return () => window.clearTimeout(timer);
  }, [result, deadline]);
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    setClock(Date.now());
    const timer = window.setInterval(() => { const now = Date.now(); setClock(now); if (now >= cooldownUntil) window.clearInterval(timer); }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - clock) / 1000));
  useEffect(() => {
    if (!result || !selectedHotelToken) return;
    const selectedIndex = result.hotels.findIndex((hotel) => hotel.hotelToken === selectedHotelToken);
    if (selectedIndex >= 0) setHotelPage(selectedIndex);
  }, [selectedHotelToken, result]);

  function change<K extends keyof StayCriteria>(field: K, value: StayCriteria[K]) {
    if (disabled) return;
    onCriteriaChange?.();
    invalidate(); setExpired(false); setError(''); setErrors({});
    const updated = { ...form, [field]: value }; setForm(updated); rememberStayForm(context, updated);
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (disabled || active.current || busy || Date.now() < cooldownUntil) return;
    const previous = currentResult.current;
    invalidate(); setError(''); setExpired(false);
    const input = { ...form, destination: form.destination.trim() };
    const invalid = errorsFor(input); setErrors(invalid);
    if (Object.keys(invalid).length) { document.getElementById(`${id}-${Object.keys(invalid)[0]}`)?.focus(); return; }
    rememberStayForm(context, input);
    const cached = readCachedStay(context, input)
      ?? (previous && ['OK', 'PARTIAL'].includes(previous.status) && previous.hotels.length > 0
        && JSON.stringify(previous.criteria) === JSON.stringify(input) && (stayExpiry(previous) ?? 0) > Date.now() ? previous : null);
    if (cached) { publish(cached); return; }
    const controller = new AbortController(); active.current = controller;
    const requestGeneration = generation.current;
    setBusy(true);
    try {
      const response = await searchStays(input, controller.signal);
      if (controller.signal.aborted || requestGeneration !== generation.current) return;
      const expiry = stayExpiry(response);
      if (response.hotels.length && (expiry === null || !Number.isFinite(expiry) || expiry <= Date.now())) { setExpired(true); return; }
      publish(response); rememberStayResult(context, response);
      if (response.retryAfterSeconds) setCooldownUntil(Date.now() + Math.min(response.retryAfterSeconds, 86400) * 1000);
    } catch {
      if (!controller.signal.aborted && requestGeneration === generation.current) setError(STAYS_UNAVAILABLE_MESSAGE);
    } finally {
      if (requestGeneration === generation.current) { setBusy(false); active.current = null; }
    }
  }
  function checkLink(event: MouseEvent<HTMLAnchorElement>) { if (deadline === null || Date.now() >= deadline) { event.preventDefault(); expire(); } }
  function selectHotel(hotelToken: string) {
    if (disabled || busy || deadline === null || Date.now() >= deadline || !quoteIsCurrent) { expire(); return; }
    onSelectHotel?.(hotelToken);
  }
  const fieldError = (field: keyof StayCriteria) => errors[field] ? <p className="field-error" id={`${id}-${field}-error`}>{errors[field]}</p> : null;
  const errorAttributes = (field: keyof StayCriteria) => ({ 'aria-invalid': !!errors[field], 'aria-describedby': errors[field] ? `${id}-${field}-error` : undefined });
  const lastCheckout = dateValue(form.checkIn) ? new Date(Date.parse(form.checkIn) + 30 * 86400000).toISOString().slice(0, 10) : undefined;
  const activePage = Math.min(hotelPage, Math.max(0, (result?.hotels.length ?? 0) - 1));
  const displayedHotels = result?.hotels.slice(activePage, activePage + 1);

  const searchForm = <form onSubmit={search} noValidate><fieldset className="unframed" disabled={disabled || busy}><legend className="sr-only">Parametry wyszukiwania noclegów</legend>
      <div className="stay-form-grid">
        <div className="field"><label htmlFor={`${id}-destination`}>Miasto noclegu</label><input id={`${id}-destination`} value={form.destination} maxLength={120} autoComplete="off" {...errorAttributes('destination')} onChange={(event) => change('destination', event.target.value)} />{fieldError('destination')}</div>
        <div className="field"><label htmlFor={`${id}-checkIn`}>Zameldowanie</label><input id={`${id}-checkIn`} type="date" min={nextDate(1)} max={nextDate(400)} value={form.checkIn} {...errorAttributes('checkIn')} onChange={(event) => change('checkIn', event.target.value)} />{fieldError('checkIn')}</div>
        <div className="field"><label htmlFor={`${id}-checkOut`}>Wymeldowanie</label><input id={`${id}-checkOut`} type="date" min={form.checkIn || nextDate(1)} max={lastCheckout} value={form.checkOut} {...errorAttributes('checkOut')} onChange={(event) => change('checkOut', event.target.value)} />{fieldError('checkOut')}</div>
        <div className="field"><label htmlFor={`${id}-rooms`}>Liczba pokoi</label><input id={`${id}-rooms`} type="number" min={1} max={form.adults} step={1} value={form.rooms ?? 1} {...errorAttributes('rooms')} onChange={(event) => change('rooms', Number(event.target.value))} />{fieldError('rooms')}</div>
        <div className="field"><label htmlFor={`${id}-currency`}>Waluta noclegu</label><select id={`${id}-currency`} value={form.currency} onChange={(event) => change('currency', event.target.value as StayCriteria['currency'])}>{['PLN', 'EUR', 'USD', 'GBP'].map((currency) => <option key={currency}>{currency}</option>)}</select></div>
      </div>
      <button type="submit" className="secondary-button" disabled={disabled || busy || cooldown > 0}>Sprawdź noclegi</button>
    </fieldset></form>;

  return <section className="panel stay-search" aria-label="Noclegi OBO Travel">
    <div className="section-heading"><div><p className="eyebrow">RZECZYWISTE OFERTY NOCLEGÓW · OBO TRAVEL</p><h3 id={`${id}-title`}>Nocleg na Twój wyjazd</h3></div><span className="small-note">{roomsText(form.rooms ?? 1)} · wycena osobno</span></div>
    <p className="muted">{form.adults} os. dorosłych · {roomsText(form.rooms ?? 1)} · liczba osób z kroku Kierunek. Nocleg wyceniany osobno.</p>
    {fieldError('adults')}
    <details className="stay-search-controls" ref={searchControls}><summary>Parametry noclegu</summary>{searchForm}</details>
    {busy && <p role="status">Sprawdzamy dostępne noclegi…</p>}
    {error && <p className="warning-text" role="alert">{error}</p>}
    {(expired || result && !quoteIsCurrent) && <p role="status">Ceny wygasły. Sprawdź ponownie.</p>}
    {cooldown > 0 && <p role="status">Kolejne wyszukiwanie za {cooldown} s.</p>}
    {quoteIsCurrent && result && <div className="stay-results" aria-live="polite">
      {!result.hotels.length && <p role="status">{STAYS_UNAVAILABLE_MESSAGE}</p>}
      {result.hotels.length > 1 && <nav className="compact-pagination" aria-label="Strony noclegów">
        <button type="button" className="text-button" disabled={activePage === 0} onClick={() => setHotelPage((page) => Math.max(0, page - 1))}>Poprzedni nocleg</button>
        <span role="status">Nocleg {activePage + 1} z {result.hotels.length}</span>
        <button type="button" className="text-button" disabled={activePage >= result.hotels.length - 1} onClick={() => setHotelPage((page) => Math.min(result.hotels.length - 1, page + 1))}>Następny nocleg</button>
      </nav>}
      <ul className="stay-cards">{displayedHotels?.map((hotel, index) => {
        const bookingUrl = oboBookingUrl(hotel.bookingUrl);
        const selected = selectedHotelToken === hotel.hotelToken;
        const priceDetails = <>
          {hotel.nightlyPrice !== null && <p>{money(hotel.nightlyPrice, hotel.currency)} za noc</p>}
          <p className="stay-source">Źródło ceny: OBO Travel · Wycena: {moment(hotel.quotedAt)} · Ważna do: {moment(hotel.expiresAt)}</p>
          <dl className="stay-fees"><div><dt>Podatki</dt><dd>{hotel.taxesIncluded === null ? 'Brak potwierdzenia' : hotel.taxesIncluded ? 'Wliczone w cenę' : 'Dodatkowo płatne'}</dd></div><div><dt>Opłaty</dt><dd>{hotel.feesIncluded === null ? 'Brak potwierdzenia' : hotel.feesIncluded ? 'Wliczone w cenę' : 'Dodatkowo płatne'}</dd></div></dl>
          {hotel.extraCharges.length > 0 && <ul className="stay-extra-charges">{hotel.extraCharges.map((charge, chargeIndex) => <li key={chargeIndex}>{charge.name}: {money(charge.amount, charge.currency)} · {charge.payableAt === 'property' ? 'płatne w obiekcie' : charge.payableAt ?? 'Miejsce płatności niepotwierdzone'}</li>)}</ul>}
          {hotel.inclusionsNote && <p className="muted">{hotel.inclusionsNote}</p>}
        </>;
        return <li key={`${hotel.hotelToken}-${index}`} className={`stay-card${selected ? ' is-selected' : ''}`}>
          <HotelPhoto hotel={hotel} />
          <h4>{hotel.name}{hotel.stars !== null && <span className="stay-stars" aria-label={`${hotel.stars} gwiazdek`}> · {hotel.stars} ★</span>}</h4>
          <p className="stay-total"><strong>{money(hotel.totalPrice, hotel.currency)}</strong> za cały pobyt · {result.criteria.adults} os. dorosłych · {roomsText(result.criteria.rooms ?? 1)}</p>
          {onSelectHotel && <button type="button" className="secondary-button stay-select-button" aria-pressed={selected} disabled={disabled || busy || !quoteIsCurrent} onClick={() => selectHotel(hotel.hotelToken)}>{selected ? 'Wybrany nocleg' : 'Wybierz nocleg'}</button>}
          <p className="stay-source">Źródło ceny: OBO Travel</p><details className="stay-price-details"><summary>Szczegóły ceny i opłat</summary>{priceDetails}</details>
          {hasLocation(hotel) ? onShowHotel && <button type="button" className="text-button stay-map-button" disabled={!!selectedHotelToken && !selected} title={selectedHotelToken && !selected ? 'Wybierz ten nocleg, aby zastąpić obecny na mapie.' : undefined} onClick={() => onShowHotel(hotel.hotelToken)}>Pokaż na mapie</button> : <p className="muted">Lokalizacja hotelu niedostępna.</p>}
          {bookingUrl ? <a href={bookingUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={checkLink} onAuxClick={checkLink} onContextMenu={checkLink}>Sprawdź ofertę w OBO <span aria-hidden="true">↗</span></a> : <p className="warning-text">Link do oferty jest niedostępny.</p>}
        </li>;
      })}</ul>
    </div>}
  </section>;
}
