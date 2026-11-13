import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, clearOwnerToken, createPlan, deletePlan, getPlaceCatalog, getPlan, getSharedPlan, previewPlan, readOwnerToken, saveOwnerToken, searchTrips, updatePlan } from './api';
import { Cost, ExternalLink, Prices, ReadOnlyPlan, TestBanner } from './components';
import { TripResults } from './TripResults';
import { dateInWarsaw, duration, fromWarsawInput, itemsFromPlan, moment, nextDate, safeUrl, warsawInput } from './format';
import type { Attraction, Criteria, ItemInput, PlaceCatalog, Plan, Priority, RoundTrip, SearchResult } from './types';
import { PlaceField } from './PlaceField';

const priorities: { value: Priority; title: string; detail: string }[] = [
  { value: 'LOWEST_TOTAL_COST', title: 'Niższy koszt', detail: 'Przejazdy i bilety wstępu' },
  { value: 'SHORTEST_TRAVEL_TIME', title: 'Krótszy dojazd', detail: 'Mniej czasu w podróży' },
  { value: 'FEWEST_TRANSFERS', title: 'Mniej przesiadek', detail: 'Spokojniejsza droga' },
  { value: 'MOST_TIME_AT_DESTINATION', title: 'Więcej czasu na miejscu', detail: 'Więcej do odkrycia' },
];
const initialCriteria = (): Criteria => ({ origin: '', destination: '', departureDate: nextDate(1), returnDate: nextDate(2), priority: 'LOWEST_TOTAL_COST', currency: 'PLN', fareType: 'STANDARD' });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Coś poszło nie tak. Spróbuj ponownie.';
function errorsFor(criteria: Criteria): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!criteria.origin.trim()) errors.origin = 'Wpisz miejsce startu.';
  if (!criteria.destination.trim()) errors.destination = 'Wpisz cel podróży.';
  if (criteria.origin.trim() && criteria.origin.trim().toLocaleLowerCase('pl') === criteria.destination.trim().toLocaleLowerCase('pl')) errors.destination = 'Cel musi być inny niż miejsce startu.';
  if (!criteria.departureDate || criteria.departureDate < dateInWarsaw()) errors.departureDate = 'Wybierz dzisiejszą lub przyszłą datę wyjazdu.';
  if (!criteria.returnDate || criteria.returnDate < criteria.departureDate) errors.returnDate = 'Powrót nie może poprzedzać wyjazdu.';
  return errors;
}

function PublicView({ token }: { token: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setPlan(null);
    getSharedPlan(token, controller.signal).then(setPlan).catch((err: unknown) => { if (!controller.signal.aborted) setError(errorMessage(err)); });
    return () => controller.abort();
  }, [token, attempt]);
  if (error) return <section className="panel narrow"><h1>Nie można otworzyć planu.</h1><p role="alert">{error}</p><button onClick={() => setAttempt((value) => value + 1)}>Spróbuj ponownie</button></section>;
  if (!plan) return <p className="loading-message" role="status">Otwieramy udostępniony plan…</p>;
  return <ReadOnlyPlan plan={plan} />;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => { const update = () => setPath(window.location.pathname); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  const shared = /^\/shared\/([^/]+)\/?$/.exec(path);
  const owner = /^\/plans\/([^/]+)\/?$/.exec(path);
  const decode = (value: string | undefined): string | null => { if (!value) return null; try { return decodeURIComponent(value); } catch { return null; } };
  const sharedToken = decode(shared?.[1]);
  const ownerTokenId = decode(owner?.[1]);
  const malformed = !!shared && !sharedToken || !!owner && !ownerTokenId;
  return <div className="page"><a className="skip-link" href="#main-content">Przejdź do treści</a><header className="header"><a className="brand" href="/" aria-label="City Break Planner — strona główna"><span className="brand-mark" aria-hidden="true">↗</span><span>city break<span className="brand-subtitle">PLANNER</span></span></a><span className="edition">Dla studentów. Z ciekawości świata.</span></header><main id="main-content">{malformed ? <section className="panel"><h1>Nieprawidłowy link do planu.</h1><p>Sprawdź, czy adres został skopiowany w całości.</p><a href="/">Wróć do planera</a></section> : sharedToken ? <PublicView token={sharedToken} /> : path !== '/' && !owner ? <section className="panel"><h1>Nie znaleziono strony.</h1><a href="/">Wróć do planera</a></section> : <Planner ownerId={ownerTokenId} onSaved={(id) => { window.history.replaceState({}, '', `/plans/${encodeURIComponent(id)}`); }} />}</main><footer><span>City Break Planner</span><span>Mniej organizowania. Więcej odkrywania.</span></footer></div>;
}

function Planner({ ownerId, onSaved }: { ownerId: string | null; onSaved: (id: string) => void }) {
  const [criteria, setCriteria] = useState<Criteria>(initialCriteria);
  const [placeCatalog, setPlaceCatalog] = useState<PlaceCatalog | null>(null);
  const [placeCatalogError, setPlaceCatalogError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SearchResult | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [saved, setSaved] = useState<{ id: string; shareUrl: string | null } | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    getPlaceCatalog(controller.signal)
      .then((catalog) => { if (!controller.signal.aborted) setPlaceCatalog(catalog); })
      .catch(() => { if (!controller.signal.aborted) setPlaceCatalogError(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!ownerId) return;
    const controller = new AbortController();
    const token = readOwnerToken(ownerId);
    if (!token) { setError('Ten plan został zapisany na innym urządzeniu albo usunięto lokalne uprawnienie. Otwórz link udostępniony do odczytu lub wróć na urządzenie właściciela.'); return; }
    setBusy('Otwieramy zapisany plan…');
    getPlan(ownerId, token, controller.signal).then(async (stored) => {
      if (controller.signal.aborted) return;
      setPlan(stored); setSaved({ id: ownerId, shareUrl: stored.shareUrl || null }); setCriteria(stored.criteria); setDirty(false);
      try { const catalog = await searchTrips(stored.criteria, controller.signal); if (!controller.signal.aborted) setResult(catalog); }
      catch { if (!controller.signal.aborted) setNotice('Zapisany plan jest dostępny. Nie udało się odświeżyć listy połączeń i atrakcji.'); }
    }).catch((err: unknown) => { if (!controller.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!controller.signal.aborted) setBusy(''); });
    return () => controller.abort();
  }, [ownerId]);

  function handleError(err: unknown) {
    if (!mounted.current) return;
    setError(errorMessage(err));
    if (err instanceof ApiError && err.errors.length) setFieldErrors(Object.fromEntries(err.errors.map((entry) => [entry.field, entry.message])));
  }
  async function calculate(nextCriteria: Criteria, trip: RoundTrip, items: ItemInput[]) {
    const preview = await previewPlan({ criteria: nextCriteria, selectedRoundTrip: trip, items });
    if (mounted.current) { setPlan(preview); setDirty(true); }
    return preview;
  }
  async function handleSearch(event: FormEvent) {
    event.preventDefault(); setNotice(''); setError('');
    const input = { ...criteria, origin: criteria.origin.trim(), destination: criteria.destination.trim() };
    const invalid = errorsFor(input); setFieldErrors(invalid);
    if (Object.keys(invalid).length) { document.getElementById(Object.keys(invalid)[0])?.focus(); return; }
    setBusy('Szukamy połączeń i sprawdzamy dane…');
    try {
      const response = await searchTrips(input);
      if (!mounted.current) return;
      if (!response.roundTripOptions.length) {
        if (plan) {
          const reason = response.status === 'NO_CONNECTION'
            ? 'Źródła potwierdziły brak kursów dla nowych kryteriów.'
            : response.status === 'PROVIDER_ERROR'
              ? 'Nie udało się sprawdzić połączeń dla nowych kryteriów.'
              : 'Nie otrzymano wariantów dla nowych kryteriów; nie potwierdza to braku kursów.';
          setError(`${reason} Poprzedni plan, wybrane punkty i uprawnienia zostały zachowane. Nie zmieniono jego terminu.`);
          return;
        }
        setResult(response); setCriteria(response.criteria);
        setPlan(null); setSaved(null); setDirty(false); return;
      }
      const sameRoute = plan && plan.criteria.origin === input.origin && plan.criteria.destination === input.destination;
      const first = response.roundTripOptions[0];
      const items = sameRoute ? itemsFromPlan(plan) : recommendationInputs(first, response.attractions);
      const preview = await previewPlan({ criteria: response.criteria, selectedRoundTrip: first, items });
      if (!mounted.current) return;
      setResult(response); setCriteria(response.criteria);
      setPlan(preview); setDirty(true);
      if (!sameRoute) setSaved(null);
    } catch (err) { handleError(err); } finally { if (mounted.current) setBusy(''); }
  }
  function recommendationInputs(trip: RoundTrip, attractions: Attraction[]): ItemInput[] {
    return trip.recommendedAttractionIds.map((id) => attractions.find((attraction) => attraction.id === id)).filter((attraction): attraction is Attraction => !!attraction).map((attraction) => ({ id: crypto.randomUUID(), attractionId: attraction.id, startsAt: null, visitMinutes: attraction.visitMinutes }));
  }
  async function selectTrip(trip: RoundTrip) {
    if (!result) return;
    setBusy('Przeliczamy plan dla wybranego połączenia…'); setError(''); setNotice('');
    try { await calculate(result.criteria, trip, plan ? itemsFromPlan(plan) : recommendationInputs(trip, result.attractions)); }
    catch (err) { handleError(err); } finally { if (mounted.current) setBusy(''); }
  }
  async function changeItems(items: ItemInput[]) {
    if (!plan) return;
    setBusy('Przeliczamy harmonogram…'); setError(''); setNotice('');
    try { await calculate(plan.criteria, plan.selectedRoundTrip, items); }
    catch (err) { handleError(err); } finally { if (mounted.current) setBusy(''); }
  }
  function moveItem(from: number, to: number) {
    if (!plan) return;
    const inputs = itemsFromPlan(plan);
    [inputs[from], inputs[to]] = [inputs[to], inputs[from]];
    void changeItems(inputs.map((item) => item.automaticTime ? { ...item, startsAt: null } : item));
  }
  async function save() {
    if (!plan) return;
    setBusy('Zapisujemy plan…'); setError(''); setNotice('');
    const input = { criteria: plan.criteria, selectedRoundTrip: plan.selectedRoundTrip, items: itemsFromPlan(plan) };
    try {
      let stored: Plan;
      if (saved) {
        const token = readOwnerToken(saved.id);
        if (!token) throw new ApiError('Nie znaleziono lokalnego uprawnienia do edycji planu.');
        stored = await updatePlan(saved.id, input, token);
      } else {
        const created = await createPlan(input); stored = created.plan;
        if (!stored.id) throw new ApiError('Brakuje identyfikatora zapisanego planu.');
        if (!saveOwnerToken(stored.id, created.ownerToken)) setNotice('Plan zapisano. Przeglądarka nie pozwala zachować uprawnienia — zachowaj tę kartę otwartą, aby móc go edytować.');
      }
      if (!stored.id || !mounted.current) return;
      setPlan(stored); setSaved({ id: stored.id, shareUrl: stored.shareUrl || null }); setDirty(false); onSaved(stored.id);
      setNotice((current) => current || 'Plan zapisany. Możesz udostępnić link tylko do odczytu.');
    } catch (err) { handleError(err); } finally { if (mounted.current) setBusy(''); }
  }
  async function removePlan() {
    if (!saved) return;
    setBusy('Usuwamy plan…'); setError('');
    try {
      const token = readOwnerToken(saved.id);
      if (!token) throw new ApiError('Nie znaleziono uprawnienia do usunięcia planu.');
      await deletePlan(saved.id, token); clearOwnerToken(saved.id); setSaved(null); setPlan(null); setResult(null); setDeleting(false); setDirty(false); window.history.replaceState({}, '', '/'); setNotice('Plan usunięty. Link udostępniony przestał działać.');
    } catch (err) { handleError(err); } finally { if (mounted.current) setBusy(''); }
  }
  async function copyShare() {
    if (!saved?.shareUrl) return;
    try { await navigator.clipboard.writeText(saved.shareUrl); setNotice('Link do odczytu skopiowany.'); }
    catch { setNotice('Nie udało się skopiować automatycznie. Zaznacz i skopiuj link poniżej.'); }
  }
  function setField(name: keyof Criteria, value: string) { setCriteria((current) => ({ ...current, [name]: value })); setFieldErrors((current) => ({ ...current, [name]: '' })); }
  function fillExampleRoute() {
    const departureDate = nextDate(1);
    setCriteria((current) => ({
      ...current,
      origin: exampleMode ? 'Warszawa' : 'Dworzec Główny',
      destination: exampleMode ? 'Gdańsk' : 'Targ Rybny',
      departureDate,
      returnDate: exampleMode ? nextDate(2) : departureDate,
    }));
    setFieldErrors({});
    setError('');
  }
  const exampleMode = placeCatalog?.testData ?? result?.testData ?? false;
  const testData = result?.testData || plan?.testData;
  const canEdit = !busy;

  return <><section className="hero"><div><p className="eyebrow">NOWE MIEJSCA, TWÓJ RYTM</p><h1>Mały wyjazd.<br />Dużo <em>możliwości.</em></h1></div><p className="lead">Wybierz cel i to, na czym najbardziej Ci zależy. Połącz podróż i zwiedzanie w jeden własny plan.</p></section>
    <section className="panel search-panel" aria-labelledby="search-title"><div className="section-heading"><div><p className="eyebrow">01 / KIERUNEK</p><h2 id="search-title">Dokąd tym razem?</h2></div><span className="small-note">Plan na Twój rytm i budżet</span></div>
      <p className="coverage-note">{exampleMode
        ? 'Tryb demo. Połączenia, ceny i atrakcje są przykładowe.'
        : 'Dane rzeczywiste w tym etapie: linia 100 w Gdańsku, Dworzec Główny ↔ Targ Rybny, w zakresie dat opublikowanym przez ZTM.'}</p>
      <form onSubmit={handleSearch} noValidate><fieldset disabled={!!busy} className="unframed"><legend className="sr-only">Szczegóły wyjazdu</legend><div className="form-grid">
        <PlaceField id="origin" label="Miejsce startu" value={criteria.origin} otherValue={criteria.destination} error={fieldErrors.origin} onChange={(value) => setField('origin', value)} placeholder="np. Dworzec Główny" catalog={placeCatalog} catalogError={placeCatalogError} disabled={!!busy} />
        <PlaceField id="destination" label="Cel podróży" value={criteria.destination} otherValue={criteria.origin} error={fieldErrors.destination} onChange={(value) => setField('destination', value)} placeholder="np. Targ Rybny" catalog={placeCatalog} catalogError={placeCatalogError} disabled={!!busy} />
        <Field id="departureDate" label="Data wyjazdu" type="date" value={criteria.departureDate} min={dateInWarsaw()} error={fieldErrors.departureDate} onChange={(value) => setField('departureDate', value)} />
        <Field id="returnDate" label="Data powrotu" type="date" value={criteria.returnDate} min={criteria.departureDate || dateInWarsaw()} error={fieldErrors.returnDate} onChange={(value) => setField('returnDate', value)} />
      </div>
      <button type="button" className="text-button" disabled={!placeCatalog && !placeCatalogError} onClick={fillExampleRoute}>Uzupełnij przykładową trasę</button>
      <fieldset className="priority-picker"><legend>Co jest dla Ciebie najważniejsze?</legend><div className="priority-options">{priorities.map((priority) => <label key={priority.value} className={`priority-option ${criteria.priority === priority.value ? 'selected' : ''}`}><input type="radio" name="priority" value={priority.value} checked={criteria.priority === priority.value} onChange={() => setField('priority', priority.value)} /><span><strong>{priority.title}</strong><small>{priority.detail}</small></span></label>)}</div></fieldset><div className="search-actions"><label className="fare-select">Porównuj taryfę<select value={criteria.fareType} onChange={(event) => setField('fareType', event.target.value)}><option value="STANDARD">Normalną</option><option value="REDUCED">Ulgową, jeśli potwierdzona</option></select></label><button className="primary-button" type="submit">Znajdź połączenia <span aria-hidden="true">↗</span></button></div></fieldset></form>
    </section>
    {busy && <p className="loading-message" role="status">{busy}</p>}{error && <div className="message error" role="alert">{error}</div>}{notice && <div className="message success" role="status">{notice}</div>}{testData && <TestBanner />}
    {result && <TripResults key={result.searchId} result={result} selectedId={plan?.selectedRoundTrip.id} busy={!!busy} onSelect={(trip) => void selectTrip(trip)} />}
    {plan && <section className="editor" aria-labelledby="editor-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">03 / NA MIEJSCU</p>
          <h2 id="editor-title">Twój plan zwiedzania</h2>
          <p className="muted">Zmieniasz powrót? Wybrane miejsca zostają — pokażemy, co wymaga Twojej decyzji.</p>
        </div>
        <span className="save-state">{dirty ? 'Zmiany niezapisane' : saved ? 'Plan zapisany' : 'Plan roboczy'}</span>
      </div>
      <div className="editor-grid">
        <section className="panel itinerary" aria-label="Harmonogram wybranych atrakcji">
          <div className="itinerary-heading"><h3>Twoje miejsca</h3><Cost summary={plan.costSummary} /></div>
          {plan.items.length === 0 && <p className="empty-note">Dodaj pierwsze miejsce z propozycji obok. Godziny i dojazdy sprawdzi planer.</p>}
          <ol className="schedule">
            {plan.items.map((item, index) => <li key={item.id} className={item.conflicts.length ? 'has-conflict' : ''}>
              <div className="schedule-item-top"><span className="number">{index + 1}</span><h4>{item.name}</h4></div>
              <p>{moment(item.startsAt)} — {moment(item.endsAt)}</p>
              <p className="muted">{item.transferMinutesFromPrevious === null ? 'Brak potwierdzonego czasu dojazdu' : `Dojazd / dojście: ${duration(item.transferMinutesFromPrevious)}`}</p>
              <ItemTime
                itemId={item.id}
                name={item.name}
                value={item.startsAt}
                automaticTime={item.automaticTime ?? false}
                disabled={!canEdit}
                onChange={(startsAt) => void changeItems(itemsFromPlan(plan).map((input) =>
                  input.id === item.id ? { ...input, startsAt, automaticTime: startsAt === null } : input))}
              />
              {item.conflicts.length > 0 && <ul className="conflicts" aria-label={`Konflikty: ${item.name}`}>
                {item.conflicts.map((conflict, conflictIndex) => <li key={`${conflict.code}-${conflictIndex}`}>{conflict.reason}</li>)}
              </ul>}
              <div className="item-controls">
                <button type="button" className="text-button" disabled={!canEdit || index === 0} aria-label={`Przesuń ${item.name} wcześniej`} onClick={() => moveItem(index, index - 1)}>↑ Wcześniej</button>
                <button type="button" className="text-button" disabled={!canEdit || index === plan.items.length - 1} aria-label={`Przesuń ${item.name} później`} onClick={() => moveItem(index, index + 1)}>↓ Później</button>
                <button type="button" className="text-button danger" disabled={!canEdit} aria-label={`Usuń ${item.name}`} onClick={() => void changeItems(itemsFromPlan(plan).filter((input) => input.id !== item.id))}>Usuń</button>
              </div>
            </li>)}
          </ol>
        </section>
      <aside className="attraction-list" aria-labelledby="attractions-title"><h3 id="attractions-title">Jeszcze coś do odkrycia</h3>{!result?.attractions.length && <p className="empty-note">Nie ma dostępnych propozycji atrakcji. Zapisane miejsca pozostają w planie.</p>}{result?.attractions.map((attraction) => <article className="attraction-card" key={attraction.id}><h4>{attraction.name}</h4><p className="muted">Na wizytę: {duration(attraction.visitMinutes)}</p><Prices prices={attraction.entryPrices} />{attraction.openingHours.status === 'UNKNOWN' && <p className="warning-text">Godziny otwarcia niepotwierdzone</p>}<button type="button" className="secondary-button" disabled={!canEdit || plan.items.some((item) => item.attractionId === attraction.id)} onClick={() => void changeItems([...itemsFromPlan(plan), { id: crypto.randomUUID(), attractionId: attraction.id, startsAt: null, visitMinutes: attraction.visitMinutes }])}>{plan.items.some((item) => item.attractionId === attraction.id) ? 'Już w planie' : `Dodaj: ${attraction.name}`}</button></article>)}</aside></div>
      <section className="panel save-panel" aria-labelledby="save-title"><div><p className="eyebrow">04 / ZACHOWAJ I PODZIEL SIĘ</p><h3 id="save-title">Dobry plan warto zachować.</h3><p className="muted">Prawo edycji zostaje w tej przeglądarce. Odbiorcy linku mogą tylko oglądać plan.</p></div><button className="primary-button" type="button" disabled={!!busy || (!dirty && !!saved)} onClick={() => void save()}>{saved ? 'Zapisz zmiany' : 'Zapisz plan'} <span aria-hidden="true">↗</span></button>{saved && <div className="share-section"><label htmlFor="share-url">Link tylko do odczytu</label><div className="share-row"><input id="share-url" readOnly value={saved.shareUrl || ''} onFocus={(event) => event.target.select()} /><button type="button" className="secondary-button" disabled={!saved.shareUrl} onClick={() => void copyShare()}>Kopiuj link</button></div>{safeUrl(saved.shareUrl) && <ExternalLink href={saved.shareUrl}>Otwórz udostępniony plan</ExternalLink>}<a href={`/plans/${encodeURIComponent(saved.id)}`}>Otwórz swój zapisany plan</a>{dirty && <p className="warning-text">Udostępniony link pokazuje ostatnią zapisaną wersję. Zapisz zmiany, aby je udostępnić.</p>}<div className="delete-section">{deleting ? <><p>Usunąć plan i unieważnić udostępniony link?</p><button className="text-button danger" disabled={!!busy} onClick={() => void removePlan()}>Tak, usuń plan</button><button className="text-button" disabled={!!busy} onClick={() => setDeleting(false)}>Zachowaj plan</button></> : <button className="text-button danger" disabled={!!busy} onClick={() => setDeleting(true)}>Usuń zapisany plan</button>}</div></div>}</section>
    </section>}
  </>;
}

function Field({ id, label, value, error, onChange, type = 'text', placeholder, min }: { id: string; label: string; value: string; error?: string; onChange: (value: string) => void; type?: string; placeholder?: string; min?: string }) { return <div className="field"><label htmlFor={id}>{label}</label><input id={id} name={id} type={type} value={value} required placeholder={placeholder} min={min} maxLength={type === 'text' ? 120 : undefined} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)} />{error && <p className="field-error" id={`${id}-error`}>{error}</p>}</div>; }
function ItemTime({ itemId, name, value, automaticTime, disabled, onChange }: {
  itemId: string;
  name: string;
  value: string;
  automaticTime: boolean;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const [edited, setEdited] = useState(warsawInput(value));
  const [error, setError] = useState('');
  useEffect(() => {
    setEdited(warsawInput(value));
    setError('');
  }, [value, automaticTime]);

  function setManualTime() {
    if (edited === warsawInput(value)) {
      onChange(value);
      return;
    }
    const parsed = fromWarsawInput(edited);
    if (parsed) onChange(parsed);
    else setError('Wybierz poprawną datę i godzinę.');
  }

  return <div className="item-time">
    <label htmlFor={`time-${itemId}`}>Początek wizyty <span className="sr-only">{name}</span> <small>({automaticTime ? 'automatycznie' : 'ręcznie'}, czas polski)</small></label>
    <div className="item-time-row">
      <input type="datetime-local" id={`time-${itemId}`} value={edited} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `time-${itemId}-error` : undefined}
        onChange={(event) => { setEdited(event.target.value); setError(''); }} />
      <button type="button" className="text-button" disabled={disabled || (!automaticTime && edited === warsawInput(value))} onClick={setManualTime}>
        {automaticTime ? 'Ustaw ręcznie' : 'Zmień godzinę'}
      </button>
      {!automaticTime && <button type="button" className="text-button" disabled={disabled} onClick={() => onChange(null)}>Ustaw automatycznie</button>}
    </div>
    {error && <p className="field-error" id={`time-${itemId}-error`}>{error}</p>}
  </div>;
}
