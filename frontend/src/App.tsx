import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, clearOwnerToken, createPlan, deletePlan, getPlaceCatalog, getPlan, getSharedPlan, previewPlan, readOwnerToken, saveOwnerToken, searchTrips, suggestAttractions, updatePlan } from './api';
import { Cost, ExternalLink, ReadOnlyPlan, TestBanner, TripDetails } from './components';
import { AttractionPicker } from './AttractionPicker';
import { emptySearchMessage, TripResults } from './TripResults';
import { dateInWarsaw, duration, fromZonedInput, itemsFromPlan, moment, nextDate, safeUrl, zonedInput } from './format';
import type { Attraction, Criteria, Interest, ItemInput, PlaceCatalog, Plan, Priority, RoundTrip, SearchResult } from './types';
import { PlaceField } from './PlaceField';
import { TripMap } from './TripMap';
import { StaySearch } from './StaySearch';
import { clearPlannerDraft, readPlannerDraft, writePlannerDraft } from './plannerDraft';
import type { StayHotel } from './types';
import { clearPlannerFlow, FLOW_STEPS, readPlannerFlow, travelContext, writePlannerFlow } from './plannerFlow';
import type { FlowStep } from './plannerFlow';

const stepLabels: Record<FlowStep, string> = { direction: 'Kierunek', connection: 'Połączenie', stay: 'Nocleg', attractions: 'Atrakcje', summary: 'Podsumowanie' };
const stepTitles: Record<FlowStep, string> = { direction: 'Dokąd tym razem?', connection: 'Wybierz połączenie', stay: 'Gdzie zatrzymasz się na noc?', attractions: 'Twój plan zwiedzania', summary: 'Twój wyjazd jest gotowy' };
const sameCriteria = (a: Criteria, b: Criteria) => (Object.keys({ ...a, ...b, travelers: 1 }) as (keyof Criteria)[]).every((key) => key === 'travelers' ? (a.travelers ?? 1) === (b.travelers ?? 1) : a[key] === b[key]);

const priorities: { value: Priority; title: string; detail: string }[] = [
  { value: 'LOWEST_TOTAL_COST', title: 'Niższy koszt', detail: 'Przejazdy i bilety wstępu' },
  { value: 'SHORTEST_TRAVEL_TIME', title: 'Krótszy dojazd', detail: 'Mniej czasu w podróży' },
  { value: 'FEWEST_TRANSFERS', title: 'Mniej przesiadek', detail: 'Spokojniejsza droga' },
  { value: 'MOST_TIME_AT_DESTINATION', title: 'Więcej czasu na miejscu', detail: 'Więcej do odkrycia' },
];
const initialCriteria = (): Criteria => ({ origin: '', destination: '', departureDate: nextDate(1), returnDate: nextDate(2), priority: 'LOWEST_TOTAL_COST', currency: 'PLN', fareType: 'STANDARD', travelers: 1 });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Coś poszło nie tak. Spróbuj ponownie.';
function errorsFor(criteria: Criteria): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!criteria.origin.trim()) errors.origin = 'Wpisz miejsce startu.';
  if (!criteria.destination.trim()) errors.destination = 'Wpisz cel podróży.';
  if (criteria.origin.trim() && criteria.origin.trim().toLocaleLowerCase('pl') === criteria.destination.trim().toLocaleLowerCase('pl')) errors.destination = 'Cel musi być inny niż miejsce startu.';
  if (!criteria.departureDate || criteria.departureDate < dateInWarsaw()) errors.departureDate = 'Wybierz dzisiejszą lub przyszłą datę wyjazdu.';
  if (!criteria.returnDate || criteria.returnDate < criteria.departureDate) errors.returnDate = 'Powrót nie może poprzedzać wyjazdu.';
  if (!Number.isInteger(criteria.travelers ?? 1) || (criteria.travelers ?? 1) < 1 || (criteria.travelers ?? 1) > 8) errors.travelers = 'Wybierz od 1 do 8 osób.';
  return errors;
}

function PublicView({ token, onDataModeChange }: { token: string; onDataModeChange: (testData: boolean) => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setPlan(null);
    getSharedPlan(token, controller.signal).then((stored) => { if (!controller.signal.aborted) { setPlan(stored); onDataModeChange(stored.testData); } }).catch((err: unknown) => { if (!controller.signal.aborted) setError(errorMessage(err)); });
    return () => controller.abort();
  }, [token, attempt]);
  if (error) return <section className="panel narrow"><h1>Nie można otworzyć planu.</h1><p role="alert">{error}</p><button onClick={() => setAttempt((value) => value + 1)}>Spróbuj ponownie</button></section>;
  if (!plan) return <p className="loading-message" role="status">Otwieramy udostępniony plan…</p>;
  return <ReadOnlyPlan plan={plan} />;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [demoMode, setDemoMode] = useState(false);
  const [plannerVersion, setPlannerVersion] = useState(0);
  function startNewPlan() {
    clearPlannerDraft(); clearPlannerFlow();
    window.history.replaceState({}, '', '/');
    setPath('/'); setPlannerVersion((version) => version + 1);
  }
  useEffect(() => { const update = () => setPath(window.location.pathname); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  const shared = /^\/shared\/([^/]+)\/?$/.exec(path);
  const owner = /^\/plans\/([^/]+)\/?$/.exec(path);
  const decode = (value: string | undefined): string | null => { if (!value) return null; try { return decodeURIComponent(value); } catch { return null; } };
  const sharedToken = decode(shared?.[1]);
  const ownerTokenId = decode(owner?.[1]);
  const malformed = !!shared && !sharedToken || !!owner && !ownerTokenId;
  const privatePlanner = !malformed && !sharedToken && (path === '/' || !!owner);
  return <div className={`page${privatePlanner ? ' page--planner' : ''}`}><a className="skip-link" href="#main-content">Przejdź do treści</a>
    <header className="header"><div className="header-row"><div className="header-start"><a className="brand" href="/" onClick={(event) => { event.preventDefault(); startNewPlan(); }} aria-label="City Break Planner — strona główna"><span className="brand-mark" aria-hidden="true">↗</span><span>city break<span className="brand-subtitle">PLANNER</span></span></a>{privatePlanner && <button type="button" className="text-button new-plan-button" onClick={startNewPlan}>＋ Nowy plan</button>}</div><div className="header-promise"><h1>Mały wyjazd. Dużo <em>możliwości.</em></h1><p>Dla studentów. Z ciekawości świata.</p></div></div>{demoMode && <TestBanner />}</header>
    <main id="main-content">{malformed ? <section className="panel"><h1>Nieprawidłowy link do planu.</h1><p>Sprawdź, czy adres został skopiowany w całości.</p><a href="/">Wróć do planera</a></section> : sharedToken ? <PublicView token={sharedToken} onDataModeChange={setDemoMode} /> : path !== '/' && !owner ? <section className="panel"><h1>Nie znaleziono strony.</h1><a href="/">Wróć do planera</a></section> : <Planner key={plannerVersion} ownerId={ownerTokenId} onDataModeChange={setDemoMode} onRemoved={() => setPath('/')} onSaved={(id) => { window.history.replaceState({}, '', `/plans/${encodeURIComponent(id)}`); }} />}</main><footer><span>City Break Planner</span><span>Mniej organizowania. Więcej odkrywania.</span></footer></div>;
}

function Planner({ ownerId, onSaved, onRemoved, onDataModeChange }: { ownerId: string | null; onSaved: (id: string) => void; onRemoved: () => void; onDataModeChange: (testData: boolean) => void }) {
  const [draft] = useState(() => ownerId ? null : readPlannerDraft());
  const [restoredFlow] = useState(() => readPlannerFlow(ownerId ? `owner:${ownerId}` : 'draft', draft ? travelContext(draft.plan.criteria) : undefined));
  const [step, setStep] = useState<FlowStep>(() => draft && sameCriteria(draft.criteria, draft.plan.criteria) ? restoredFlow?.step ?? 'connection' : 'direction');
  const [furthest, setFurthest] = useState<FlowStep>(draft ? restoredFlow?.furthest ?? 'connection' : 'direction');
  const [chosenHotelToken, setChosenHotelToken] = useState<string | null>(restoredFlow?.chosenHotelToken ?? null);
  const [staySkipped, setStaySkipped] = useState(restoredFlow?.staySkipped ?? false);
  const [attractionTab, setAttractionTab] = useState<'catalog' | 'schedule'>(restoredFlow?.attractionTab ?? 'catalog');
  const [mobileMap, setMobileMap] = useState(false);
  const [criteria, setCriteria] = useState<Criteria>(() => draft?.criteria ?? initialCriteria());
  const [placeCatalog, setPlaceCatalog] = useState<PlaceCatalog | null>(null);
  const [placeCatalogError, setPlaceCatalogError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SearchResult | null>(draft?.result ?? null);
  const [plan, setPlan] = useState<Plan | null>(draft?.plan ?? null);
  const [stayHotels, setStayHotels] = useState<StayHotel[]>([]);
  const [selectedHotelToken, setSelectedHotelToken] = useState<string | null>(null);
  const [hotelFocusRequest, setHotelFocusRequest] = useState(0);
  const [saved, setSaved] = useState<{ id: string; shareUrl: string | null } | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(draft ? 'Przywrócono plan roboczy z tej karty.' : '');
  const [dirty, setDirty] = useState(!!draft);
  const [deleting, setDeleting] = useState(false);
  const mounted = useRef(true);
  const previousStep = useRef(step);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (ownerId || saved || !plan || !result) { clearPlannerDraft(); return; }
    writePlannerDraft({ criteria, plan, result });
  }, [ownerId, saved, criteria, plan, result]);

  useEffect(() => {
    if (plan) writePlannerFlow(saved ? `owner:${saved.id}` : ownerId ? `owner:${ownerId}` : 'draft', travelContext(plan.criteria), { step, furthest, chosenHotelToken, staySkipped, attractionTab });
  }, [ownerId, saved, plan, step, furthest, chosenHotelToken, staySkipped, attractionTab]);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    document.getElementById('wizard-stage-title')?.focus({ preventScroll: true });
    document.querySelector('.wizard-content')?.scrollTo?.({ top: 0 });
  }, [step]);

  function goTo(next: FlowStep) {
    setStep(next); setMobileMap(false);
    setFurthest((current) => FLOW_STEPS.indexOf(next) > FLOW_STEPS.indexOf(current) ? next : current);
  }

  function showHotel(token: string) {
    setSelectedHotelToken(token);
    setHotelFocusRequest((current) => current + 1);
    setMobileMap(true);
  }

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
      const flow = restoredFlow?.context === travelContext(stored.criteria) ? restoredFlow : null;
      setStep(flow?.step ?? 'summary'); setFurthest('summary');
      setChosenHotelToken(flow?.chosenHotelToken ?? null); setStaySkipped(flow?.staySkipped ?? false);
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
  async function calculate(nextCriteria: Criteria, trip: RoundTrip, items: ItemInput[], lodging = plan?.lodging ?? null) {
    const preview = await previewPlan({ criteria: nextCriteria, selectedRoundTrip: trip, items, lodging });
    if (mounted.current) { setPlan(preview); setDirty(true); }
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
          const { title, hint } = emptySearchMessage(response);
          const reason = [title.replace(/\.?$/, '.'), hint].filter(Boolean).join(' ');
          setError(`${reason} Poprzedni plan, wybrane punkty i uprawnienia zostały zachowane. Nie zmieniono jego terminu.`);
          return;
        }
        setResult(response); setCriteria(response.criteria);
        setPlan(null); setSaved(null); setDirty(false); return;
      }
      const sameRoute = plan && plan.criteria.origin === response.criteria.origin && plan.criteria.destination === response.criteria.destination;
      const first = response.roundTripOptions[0];
      const items = sameRoute ? itemsFromPlan(plan) : [];
      const sameStayContext = plan && travelContext(plan.criteria) === travelContext(response.criteria);
      const preview = await previewPlan({ criteria: response.criteria, selectedRoundTrip: first, items, lodging: sameStayContext ? plan.lodging ?? null : null });
      if (!mounted.current) return;
      setResult(response); setCriteria(response.criteria);
      setPlan(preview); setDirty(true);
      if (!sameRoute) setSaved(null);
      if (!plan || travelContext(plan.criteria) !== travelContext(response.criteria)) { setChosenHotelToken(null); setStaySkipped(false); setFurthest('connection'); }
      goTo('connection');
    } catch (err) { handleError(err); } finally { if (mounted.current) setBusy(''); }
  }
  async function chooseHotel(token: string) {
    if (!plan || busy) return;
    const hotel = stayHotels.find((item) => item.hotelToken === token && Date.parse(item.expiresAt) > Date.now());
    if (!hotel) return;
    setBusy('Uwzględniamy nocleg w planie…'); setError('');
    const lodging = hotel.location ? { name: hotel.name, ...hotel.location } : null;
    try {
      await calculate(plan.criteria, plan.selectedRoundTrip, itemsFromPlan(plan).map((item) => item.automaticTime ? { ...item, startsAt: null } : item), lodging);
      if (!mounted.current) return;
      setChosenHotelToken(token); setSelectedHotelToken(token); setStaySkipped(false);
      if (!lodging) setNotice('Lokalizacja noclegu jest niedostępna. Nie możemy oszacować dojścia do atrakcji.');
    } catch (err) { handleError(err); } finally { if (mounted.current) setBusy(''); }
  }
  async function skipStay(advance = true) {
    if (!plan || busy) return;
    if (plan.lodging) {
      setBusy('Przeliczamy plan bez noclegu…'); setError('');
      try { await calculate(plan.criteria, plan.selectedRoundTrip, itemsFromPlan(plan).map((item) => item.automaticTime ? { ...item, startsAt: null } : item), null); }
      catch (err) { handleError(err); return; }
      finally { if (mounted.current) setBusy(''); }
    }
    if (!mounted.current) return;
    setStaySkipped(advance); setChosenHotelToken(null); setSelectedHotelToken(null); if (advance) goTo('attractions');
  }
  async function selectTrip(trip: RoundTrip) {
    if (!result) return;
    setBusy('Przeliczamy plan dla wybranego połączenia…'); setError(''); setNotice('');
    try { await calculate(result.criteria, trip, plan ? itemsFromPlan(plan) : []); }
    catch (err) { handleError(err); } finally { if (mounted.current) setBusy(''); }
  }
  async function recommend(interest: Interest, limit: number) {
    if (!plan) return null;
    setBusy('Szukamy atrakcji pasujących do Twojego wyjazdu…'); setError(''); setNotice('');
    try {
      return await suggestAttractions(plan.criteria, plan.selectedRoundTrip.id, interest, limit);
    } catch (err) {
      handleError(err);
      return null;
    } finally { if (mounted.current) setBusy(''); }
  }
  function addAttraction(attraction: Attraction) {
    if (!plan || plan.items.some((item) => item.attractionId === attraction.id)) return;
    void changeItems([...itemsFromPlan(plan), { id: crypto.randomUUID(), attractionId: attraction.id,
      startsAt: null, visitMinutes: attraction.visitMinutes }]);
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
    const input = { criteria: plan.criteria, selectedRoundTrip: plan.selectedRoundTrip, items: itemsFromPlan(plan), lodging: plan.lodging ?? null };
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
      await deletePlan(saved.id, token); clearOwnerToken(saved.id); clearPlannerFlow(); setSaved(null); setPlan(null); setResult(null); setDeleting(false); setDirty(false); setChosenHotelToken(null); setStaySkipped(false); setStep('direction'); setFurthest('direction'); window.history.replaceState({}, '', '/'); onRemoved(); setNotice('Plan usunięty. Link udostępniony przestał działać.');
    } catch (err) { handleError(err); } finally { if (mounted.current) setBusy(''); }
  }
  async function copyShare() {
    if (!saved?.shareUrl) return;
    try { await navigator.clipboard.writeText(saved.shareUrl); setNotice('Link do odczytu skopiowany.'); }
    catch { setNotice('Nie udało się skopiować automatycznie. Zaznacz i skopiuj link poniżej.'); }
  }
  function setField<Key extends keyof Criteria>(name: Key, value: Criteria[Key]) {
    setCriteria((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: '' }));
  }
  function fillExampleRoute() {
    const departureDate = nextDate(1);
    const europeanDemo = placeCatalog?.places.some((place) => place.value === 'Londyn');
    setCriteria((current) => ({
      ...current,
      origin: europeanDemo ? 'Londyn' : exampleMode ? 'Warszawa' : 'Dworzec Główny',
      destination: europeanDemo ? 'Paryż' : exampleMode ? 'Gdańsk' : 'Targ Rybny',
      departureDate,
      returnDate: exampleMode ? nextDate(2) : departureDate,
    }));
    setFieldErrors({});
    setError('');
  }
  const exampleMode = placeCatalog?.testData ?? result?.testData ?? false;
  const testData = result?.testData || plan?.testData;
  const canEdit = !busy;
  const visitZone = plan?.selectedRoundTrip.outbound.segments.at(-1)?.destination.timeZone;

  const activeCriteriaMatch = !plan || sameCriteria(criteria, plan.criteria);
  const chosenHotel = stayHotels.find((hotel) => hotel.hotelToken === chosenHotelToken && Date.parse(hotel.expiresAt) > Date.now());
  const stepIndex = FLOW_STEPS.indexOf(step);
  const hasMap = !!plan && stepIndex >= 2;
  const nextStep = FLOW_STEPS[Math.min(stepIndex + 1, FLOW_STEPS.length - 1)];
  useEffect(() => { onDataModeChange(!!(testData || exampleMode)); }, [testData, exampleMode, onDataModeChange]);
  const previousMapView = useRef(false);
  useEffect(() => {
    if (hasMap && mobileMap) document.querySelector<HTMLElement>('.wizard-map-pane')?.focus({ preventScroll: true });
    else if (previousMapView.current) document.getElementById('wizard-stage-title')?.focus({ preventScroll: true });
    previousMapView.current = hasMap && mobileMap;
  }, [mobileMap, hasMap]);

  return <section className="planner-workflow" aria-label="Planowanie wyjazdu">
    <nav className="wizard-steps" aria-label="Etapy planowania"><ol>{FLOW_STEPS.map((item, index) => <li key={item}>
      <button type="button" aria-current={step === item ? 'step' : undefined} disabled={!!busy || index > FLOW_STEPS.indexOf(furthest) || index > 0 && (!plan || !activeCriteriaMatch)} onClick={() => goTo(item)}><span className="step-number" aria-hidden="true">{index + 1}</span><span>{stepLabels[item]}</span></button>
    </li>)}</ol></nav>
    <div className="wizard-progress"><p className="eyebrow">KROK {stepIndex + 1} Z 5</p><h2 className="wizard-step-title" id="wizard-stage-title" tabIndex={-1}>{stepTitles[step]}</h2>{plan && step !== 'direction' && <p className="muted">{plan.criteria.origin} → {plan.criteria.destination} · {plan.criteria.departureDate} — {plan.criteria.returnDate} · {plan.criteria.travelers ?? 1} os.</p>}</div>
    <div className="wizard-notices" aria-live="polite">{busy && <p className="loading-message" role="status">{busy}</p>}{error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}</div>
    <div className="wizard-view-toggle" hidden={!hasMap} role="group" aria-label="Widok bieżącego kroku"><button type="button" aria-pressed={!mobileMap} onClick={() => setMobileMap(false)}>Plan</button><button type="button" aria-pressed={mobileMap} onClick={() => setMobileMap(true)}>Mapa</button></div>
    <div className={'wizard-stage' + (hasMap ? ' has-map' : '') + (mobileMap ? ' show-mobile-map' : '')} data-step={step}>
      <div className="wizard-content" tabIndex={0} aria-label="Treść bieżącego etapu">
        <div className="wizard-step" hidden={step !== 'direction'}><section className="panel search-panel" aria-labelledby="wizard-stage-title">

      <form id="wizard-search-form" onSubmit={handleSearch} noValidate><fieldset disabled={!!busy} className="unframed"><legend className="sr-only">Szczegóły wyjazdu</legend><div className="form-grid">
        <PlaceField id="origin" label="Miejsce startu" value={criteria.origin} otherValue={criteria.destination} error={fieldErrors.origin} onChange={(value) => setField('origin', value)} placeholder="np. Londyn" catalog={placeCatalog} catalogError={placeCatalogError} disabled={!!busy} />
        <PlaceField id="destination" label="Cel podróży" value={criteria.destination} otherValue={criteria.origin} error={fieldErrors.destination} onChange={(value) => setField('destination', value)} placeholder="np. Paryż" catalog={placeCatalog} catalogError={placeCatalogError} disabled={!!busy} />
        <Field id="departureDate" label="Data wyjazdu" type="date" value={criteria.departureDate} min={dateInWarsaw()} error={fieldErrors.departureDate} onChange={(value) => setField('departureDate', value)} />
        <Field id="returnDate" label="Data powrotu" type="date" value={criteria.returnDate} min={criteria.departureDate || dateInWarsaw()} error={fieldErrors.returnDate} onChange={(value) => setField('returnDate', value)} />
        <div className="field travelers-field"><label htmlFor="travelers">Liczba osób</label><input id="travelers" type="number" min={1} max={8} step={1} value={criteria.travelers ?? 1} aria-invalid={!!fieldErrors.travelers} aria-describedby={fieldErrors.travelers ? 'travelers-error' : 'travelers-hint'} onChange={(event) => setField('travelers', Number(event.target.value))} />{fieldErrors.travelers ? <p className="field-error" id="travelers-error">{fieldErrors.travelers}</p> : <p className="place-hint" id="travelers-hint">Transport i wstępy dla całej grupy. Nocleg: osoby dorosłe.</p>}</div>
      </div>
      <button type="button" className="text-button" disabled={!placeCatalog && !placeCatalogError} onClick={fillExampleRoute}>Uzupełnij przykładową trasę</button>
      <fieldset className="priority-picker"><legend>Co jest dla Ciebie najważniejsze?</legend><div className="priority-options">{priorities.map((priority) => <label key={priority.value} className={`priority-option ${criteria.priority === priority.value ? 'selected' : ''}`}><input type="radio" name="priority" value={priority.value} checked={criteria.priority === priority.value} onChange={() => setField('priority', priority.value)} /><span><strong>{priority.title}</strong><small>{priority.detail}</small></span></label>)}</div></fieldset><div className="search-actions"><label className="fare-select">Porównuj taryfę<select value={criteria.fareType} onChange={(event) => setField('fareType', event.target.value as Criteria['fareType'])}><option value="STANDARD">Normalną</option><option value="REDUCED">Ulgową, jeśli potwierdzona</option></select></label></div></fieldset></form></section>{result && !plan && !result.roundTripOptions.length && <div className={"message " + emptySearchMessage(result).style} role="status"><h3>{emptySearchMessage(result).title}</h3>{emptySearchMessage(result).hint && <p>{emptySearchMessage(result).hint}</p>}</div>}{plan && !activeCriteriaMatch && <div className="message warning"><p>Poprzedni plan dotyczy trasy {plan.criteria.origin} → {plan.criteria.destination}, {plan.criteria.departureDate} — {plan.criteria.returnDate}.</p><button type="button" className="text-button" disabled={!!busy} onClick={() => { setCriteria(plan.criteria); setFieldErrors({}); setError(''); goTo('connection'); }}>Wróć do poprzedniego planu</button></div>}</div>
        <div className="wizard-step" hidden={step !== 'connection'}>{result && <TripResults key={result.searchId} result={result} selectedId={plan?.selectedRoundTrip.id} busy={!!busy} onSelect={(trip) => void selectTrip(trip)} compact />}</div>
        <div className="wizard-step" hidden={step !== 'stay'}>{plan && <StaySearch compact criteria={plan.criteria} onHotelsChange={setStayHotels} onShowHotel={showHotel} selectedHotelToken={chosenHotelToken} onSelectHotel={(token) => void chooseHotel(token)} disabled={!!busy} onCriteriaChange={() => void skipStay(false)} />}</div>
        <div className="wizard-step" hidden={step !== 'attractions'}>{plan && <>
          <div className="wizard-attractions-tabs" role="group" aria-label="Widok atrakcji"><button type="button" aria-pressed={attractionTab === 'catalog'} onClick={() => setAttractionTab('catalog')}>Propozycje</button><button type="button" aria-pressed={attractionTab === 'schedule'} onClick={() => setAttractionTab('schedule')}>Harmonogram ({plan.items.length})</button></div>
          <div hidden={attractionTab !== 'catalog'}><AttractionPicker compact attractions={result?.attractions ?? []} selected={plan.items} disabled={!canEdit} contextKey={(result?.searchId ?? '') + '/' + plan.selectedRoundTrip.id} onRecommend={recommend} onAdd={addAttraction} /></div>
          <div hidden={attractionTab !== 'schedule'}><section className="panel itinerary" aria-label="Harmonogram wybranych atrakcji">
          <div className="itinerary-heading"><h3>Twoje miejsca</h3><Cost summary={plan.costSummary} travelers={plan.criteria.travelers ?? 1} /></div>
          {plan.items.length === 0 && <p className="empty-note">Dodaj pierwsze miejsce z propozycji obok. Godziny i dojazdy sprawdzi planer.</p>}
          <ol className="schedule">
            {plan.items.map((item, index) => <li key={item.id} className={item.conflicts.length ? 'has-conflict' : ''}>
              <div className="schedule-item-top"><span className="number">{index + 1}</span><h4>{item.name}</h4></div>
              <p>{moment(item.startsAt, visitZone)} — {moment(item.endsAt, visitZone)}</p>
              <p className="muted">{item.transferMinutesFromPrevious === null ? 'Brak potwierdzonego czasu dojazdu' : item.transferBasis === 'ESTIMATED_WALKING' ? `Szacowane dojście pieszo (${item.transferFrom ?? 'nocleg'}): ${duration(item.transferMinutesFromPrevious)}` : `Dojazd / dojście: ${duration(item.transferMinutesFromPrevious)}`}</p>
              <ItemTime
                itemId={item.id}
                name={item.name}
                value={item.startsAt}
                timeZone={visitZone}
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
        </section></div>
        </>}</div>
        <div className="wizard-step" hidden={step !== 'summary'}>{plan && <div className="wizard-summary">
          <section className="panel summary-card"><h3>Podróż i zwiedzanie</h3><Cost summary={plan.costSummary} travelers={plan.criteria.travelers ?? 1} /><p className="muted">{plan.items.length} wybranych atrakcji · {plan.items.reduce((count, item) => count + item.conflicts.length, 0)} konfliktów w harmonogramie</p><details><summary>Szczegóły podróży</summary><TripDetails trip={plan.selectedRoundTrip} /></details><button type="button" className="text-button" onClick={() => goTo('attractions')}>Zmień atrakcje</button></section>
          <section className="panel summary-card"><h3>Nocleg</h3>{chosenHotel || plan.lodging ? <><p><strong>{chosenHotel?.name ?? plan.lodging?.name}</strong></p><p className="muted">OBO Travel · nocleg wyceniany osobno. Aktualna cena i opłaty w kroku Nocleg.</p></> : <p className="muted">{chosenHotelToken && !staySkipped ? 'Oferta noclegu wygasła lub nie jest już dostępna. Sprawdź ją ponownie.' : 'Wyjazd bez wybranego noclegu.'}</p>}<button type="button" className="text-button" onClick={() => goTo('stay')}>{chosenHotel || plan.lodging ? 'Zmień nocleg' : 'Wybierz nocleg'}</button></section>
          <section className="panel save-panel" aria-labelledby="save-title"><div><h3 id="save-title">Dobry plan warto zachować.</h3><p className="muted">Prawo edycji zostaje w tej przeglądarce. Odbiorcy linku mogą tylko oglądać plan.</p></div>{saved && <div className="share-section"><label htmlFor="share-url">Link tylko do odczytu</label><div className="share-row"><input id="share-url" readOnly value={saved.shareUrl || ''} onFocus={(event) => event.target.select()} /><button type="button" className="secondary-button" disabled={!saved.shareUrl} onClick={() => void copyShare()}>Kopiuj link</button></div>{safeUrl(saved.shareUrl) && <ExternalLink href={saved.shareUrl}>Otwórz udostępniony plan</ExternalLink>}<a href={`/plans/${encodeURIComponent(saved.id)}`}>Otwórz swój zapisany plan</a>{dirty && <p className="warning-text">Udostępniony link pokazuje ostatnią zapisaną wersję. Zapisz zmiany, aby je udostępnić.</p>}<div className="delete-section">{deleting ? <><p>Usunąć plan i unieważnić udostępniony link?</p><button className="text-button danger" disabled={!!busy} onClick={() => void removePlan()}>Tak, usuń plan</button><button className="text-button" disabled={!!busy} onClick={() => setDeleting(false)}>Zachowaj plan</button></> : <button className="text-button danger" disabled={!!busy} onClick={() => setDeleting(true)}>Usuń zapisany plan</button>}</div></div>}</section>
        </div>}</div>
      </div>
      <aside className="wizard-map-pane" hidden={!hasMap} tabIndex={-1} aria-label="Mapa bieżącego kroku">{plan && <TripMap plan={plan} attractions={result?.attractions} hotels={chosenHotelToken ? stayHotels.filter((hotel) => hotel.hotelToken === chosenHotelToken) : plan.lodging || staySkipped ? [] : stayHotels} selectedHotelToken={selectedHotelToken} hotelFocusRequest={hotelFocusRequest} viewKey={step + '/' + String(mobileMap)} />}</aside>
    </div>
    <nav className="wizard-navigation" aria-label="Nawigacja etapów"><button type="button" className="secondary-button" disabled={!!busy || stepIndex === 0} onClick={() => goTo(FLOW_STEPS[stepIndex - 1])}>Wstecz</button><span className="wizard-nav-summary">{step === 'attractions' && plan ? plan.items.length + ' wybranych atrakcji' : step === 'stay' ? chosenHotel || plan?.lodging ? 'Nocleg wybrany' : 'Nocleg jest opcjonalny' : stepLabels[step]}</span>
      {step === 'stay' && <button type="button" className="text-button" disabled={!!busy} onClick={() => void skipStay()}>Pomiń nocleg</button>}
      {step === 'direction' ? <button className="primary-button" type="submit" form="wizard-search-form" disabled={!!busy}>Znajdź połączenia <span aria-hidden="true">↗</span></button> : step === 'summary' ? <button className="primary-button" type="button" disabled={!!busy || !plan || (!dirty && !!saved)} onClick={() => void save()}>{saved ? 'Zapisz zmiany' : 'Zapisz plan'} <span aria-hidden="true">↗</span></button> : <button type="button" className="primary-button" disabled={!!busy || !plan || step === 'stay' && !chosenHotel && !plan.lodging && !staySkipped} onClick={() => goTo(nextStep)}>Dalej: {stepLabels[nextStep]}</button>}
    </nav>
  </section>;
}

function Field({ id, label, value, error, onChange, type = 'text', placeholder, min }: { id: string; label: string; value: string; error?: string; onChange: (value: string) => void; type?: string; placeholder?: string; min?: string }) { return <div className="field"><label htmlFor={id}>{label}</label><input id={id} name={id} type={type} value={value} required placeholder={placeholder} min={min} maxLength={type === 'text' ? 120 : undefined} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)} />{error && <p className="field-error" id={`${id}-error`}>{error}</p>}</div>; }
function ItemTime({ itemId, name, value, timeZone, automaticTime, disabled, onChange }: {
  itemId: string;
  name: string;
  value: string;
  timeZone?: string;
  automaticTime: boolean;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const currentTime = zonedInput(value, timeZone);
  const [edited, setEdited] = useState(currentTime);
  const [error, setError] = useState('');
  useEffect(() => {
    setEdited(currentTime);
    setError('');
  }, [currentTime, automaticTime]);

  function setManualTime() {
    if (edited === currentTime) {
      onChange(value);
      return;
    }
    const parsed = fromZonedInput(edited, timeZone);
    if (parsed) onChange(parsed);
    else setError('Wybierz poprawną datę i godzinę.');
  }

  return <div className="item-time">
    <label htmlFor={`time-${itemId}`}>Początek wizyty <span className="sr-only">{name}</span> <small>({automaticTime ? 'automatycznie' : 'ręcznie'}, czas lokalny)</small></label>
    <div className="item-time-row">
      <input type="datetime-local" id={`time-${itemId}`} value={edited} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `time-${itemId}-error` : undefined}
        onChange={(event) => { setEdited(event.target.value); setError(''); }} />
      <button type="button" className="text-button" disabled={disabled || (!automaticTime && edited === currentTime)} onClick={setManualTime}>
        {automaticTime ? 'Ustaw ręcznie' : 'Zmień godzinę'}
      </button>
      {!automaticTime && <button type="button" className="text-button" disabled={disabled} onClick={() => onChange(null)}>Ustaw automatycznie</button>}
    </div>
    {error && <p className="field-error" id={`time-${itemId}-error`}>{error}</p>}
  </div>;
}
