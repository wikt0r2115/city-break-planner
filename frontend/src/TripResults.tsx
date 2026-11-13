import { useState, useSyncExternalStore } from 'react';
import { ExternalLink, Prices } from './components';
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
        <strong>{segment.operator}</strong>
        <p className="journey-times">{moment(segment.departureAt)} <span aria-hidden="true">→</span> {moment(segment.arrivalAt)}</p>
        <Prices prices={segment.prices} compact />
        <div className="inline-links">
          <ExternalLink href={segment.bookingUrl}>Strona przewoźnika</ExternalLink>
          <ExternalLink href={segment.mapUrl}>Otwórz mapę</ExternalLink>
        </div>
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
  return <article className={selected ? 'trip-card chosen' : 'trip-card'}>
    <button
      type="button"
      className="trip-card-select"
      aria-label={`Wariant ${rank}, powrót ${moment(trip.returnJourney.departureAt)}`}
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
    <TripLeg journey={trip.outbound} title="Wyjazd" />
    <TripLeg journey={trip.returnJourney} title="Powrót" />
  </article>;
}

function ResultStatus({ result }: { result: SearchResult }) {
  const { status, roundTripOptions, sources } = result;
  if (status === 'NO_CONNECTION') {
    return <div className="message empty"><h3>Brak potwierdzonych połączeń</h3><p>Spróbuj zmienić termin.</p></div>;
  }
  if (status === 'PROVIDER_ERROR') {
    return <div className="message error"><h3>Nie udało się sprawdzić połączeń</h3><p>Spróbuj ponownie.</p></div>;
  }
  if (roundTripOptions.length) {
    return status === 'PARTIAL' ? <p className="message warning">Część danych jest niedostępna.</p> : null;
  }
  if (sources.some((source) => source.reasonCode === 'UNSUPPORTED_ROUTE')) {
    return <div className="message empty"><h3>Trasa poza zakresem planera</h3><p>Wybierz Dworzec Główny i Targ Rybny w Gdańsku.</p></div>;
  }
  if (sources.some((source) => source.reasonCode === 'OUTSIDE_COVERAGE')) {
    return <div className="message empty"><h3>Brak rozkładu dla wybranych dat</h3><p>Spróbuj wybrać bliższy termin.</p></div>;
  }
  return <p className="message warning">Nie udało się potwierdzić połączeń dla tych kryteriów.</p>;
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
