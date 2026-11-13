import { useState, useSyncExternalStore } from 'react';
import { modes, SegmentLinks, SegmentPrices, SegmentSchedule, TripMetrics } from './components';
import { moment, money } from './format';
import type { Journey, SearchResult, RoundTrip } from './types';

const wideResults = '(min-width: 1051px)';

function subscribeToResultsWidth(notify: () => void) {
  const query = window.matchMedia?.(wideResults);
  query?.addEventListener('change', notify);
  return () => query?.removeEventListener('change', notify);
}

function variantsPerPage() {
  return window.matchMedia?.(wideResults).matches ? 3 : 2;
}

function TripLeg({ journey, title }: { journey: Journey; title: string }) {
  return <section className="journey trip-leg" aria-label={title}>
    <h4>{title}</h4>
    <ol className="segments">
      {journey.segments.map((segment) => <li key={segment.id}>
        <strong>{segment.origin.timeZone && modes[segment.mode] && `${modes[segment.mode]} · `}{segment.operator}</strong>
        {(segment.scheduleBasis || segment.origin.timeZone) && <p>{segment.origin.name} → {segment.destination.name}</p>}
        <p className="journey-times">{moment(segment.departureAt, segment.origin.timeZone)} <span aria-hidden="true">→</span> {moment(segment.arrivalAt, segment.destination.timeZone)}</p>
        <SegmentPrices segment={segment} compact />
        <SegmentSchedule segment={segment} />
        <SegmentLinks segment={segment} />
      </li>)}
    </ol>
  </section>;
}

function TripCard({ trip, rank, selected, busy, onSelect }: {
  trip: RoundTrip;
  rank: number;
  selected: boolean;
  busy: boolean;
  onSelect: (trip: RoundTrip) => void;
}) {
  const { complete, total, currency } = trip.costSummary;
  const showMetrics = [trip.outbound, trip.returnJourney].some((journey) =>
    journey.segments.some((segment) => segment.scheduleBasis || segment.origin.timeZone));
  return <article className={selected ? 'trip-card chosen' : 'trip-card'}>
    <button
      type="button"
      className="trip-card-select"
      aria-label={`Wariant ${rank}, powrót ${moment(trip.returnJourney.departureAt, trip.returnJourney.segments[0]?.origin.timeZone)}`}
      aria-pressed={selected}
      aria-disabled={busy}
      onClick={() => { if (!busy && !selected) onSelect(trip); }}
    />
    <div className="trip-card-top">
      <div className="cost">
        <strong>{complete && total !== null ? money(total, currency) : 'Łączny koszt niepotwierdzony'}</strong>
      </div>
      {selected && <span className="selected-badge">Wybrany</span>}
    </div>
    {showMetrics && <TripMetrics trip={trip} />}
    <TripLeg journey={trip.outbound} title="Wyjazd" />
    <TripLeg journey={trip.returnJourney} title="Powrót" />
  </article>;
}

export function emptySearchMessage({ status, sources }: SearchResult) {
  const reasons = new Set(sources.map((source) => source.reasonCode));
  if (status === 'NO_CONNECTION') {
    return { style: 'empty', title: 'Brak potwierdzonych połączeń', hint: 'Spróbuj zmienić termin.' };
  }
  if (reasons.has('AMBIGUOUS_PLACE')) {
    return { style: 'empty', title: 'Doprecyzuj miejsce', hint: 'Wpisz pełną nazwę stacji lub wybierz podpowiedź.' };
  }
  if (reasons.has('OUTSIDE_COVERAGE')) {
    return { style: 'empty', title: 'Brak rozkładu dla wybranych dat', hint: 'Wybierz termin objęty opublikowanym rozkładem.' };
  }
  if (status === 'PROVIDER_ERROR') {
    return { style: 'error', title: 'Nie udało się sprawdzić połączeń', hint: 'Spróbuj ponownie.' };
  }
  if (reasons.has('UNSUPPORTED_ROUTE')) {
    return { style: 'empty', title: 'Trasa poza zakresem planera', hint: 'Wybierz inną parę miejsc z podpowiedzi.' };
  }
  return { style: 'warning', title: 'Nie udało się potwierdzić połączeń dla tych kryteriów.', hint: null };
}

function ResultStatus({ result }: { result: SearchResult }) {
  if (result.roundTripOptions.length) return null;
  const { style, title, hint } = emptySearchMessage(result);
  return <div className={`message ${style}`}>
    <h3>{title}</h3>
    {hint && <p>{hint}</p>}
  </div>;
}

export function TripResults({ result, selectedId, busy, onSelect }: {
  result: SearchResult;
  selectedId?: string;
  busy: boolean;
  onSelect: (trip: RoundTrip) => void;
}) {
  const pageSize = useSyncExternalStore(subscribeToResultsWidth, variantsPerPage);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const trips = result.roundTripOptions;
  const pageCount = Math.ceil(trips.length / pageSize);
  const page = Math.min(Math.floor(visibleIndex / pageSize), Math.max(0, pageCount - 1));
  const first = page * pageSize;

  return <section className="results" aria-labelledby="results-title">
    <div className="section-heading">
      <h2 id="results-title">{result.criteria.origin} → {result.criteria.destination}</h2>
    </div>
    <ResultStatus result={result} />
    {trips.length > 0 && <div className="option-grid">
      {trips.slice(first, first + pageSize).map((trip, index) => <TripCard
        key={trip.id}
        trip={trip}
        rank={first + index + 1}
        selected={trip.id === selectedId}
        busy={busy}
        onSelect={onSelect}
      />)}
    </div>}
    {pageCount > 1 && <nav className="results-pagination" aria-label="Strony wyników">
      <button type="button" className="secondary-button" disabled={page === 0} onClick={() => setVisibleIndex(first - pageSize)}>Poprzednia</button>
      <span role="status">Strona {page + 1} z {pageCount}</span>
      <button type="button" className="secondary-button" disabled={page + 1 === pageCount} onClick={() => setVisibleIndex(first + pageSize)}>Następna</button>
    </nav>}
  </section>;
}
