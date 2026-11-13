import type { CostSummary, Journey, Plan, Price, RoundTrip, Segment } from './types';
import { duration, moment, money, safeUrl } from './format';

export function ExternalLink({ href, children }: { href?: string | null; children: React.ReactNode }) {
  const url = safeUrl(href);
  return url ? <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}<span aria-hidden="true"> ↗</span></a> : null;
}
export function TestBanner() { return <div className="test-banner" role="note"><strong>Dane testowe — to nie są rzeczywiste oferty.</strong> Przykładowe ceny i połączenia służą do sprawdzenia działania planera.</div>; }
export function Cost({ summary }: { summary: CostSummary }) { return <div className="cost"><strong>{summary.complete && summary.total !== null ? money(summary.total, summary.currency) : 'Łączny koszt niepotwierdzony'}</strong><span>{summary.fareType === 'REDUCED' ? 'Taryfa ulgowa' : 'Taryfa normalna'} · przejazdy i wybrane wstępy</span>{!summary.complete && <span className="warning-text">Brakuje potwierdzenia {summary.missingComponents?.length || 'części'} składników ceny.</span>}</div>; }
export function Prices({ prices, compact = false }: { prices: Price[]; compact?: boolean }) {
  return <div className="prices">{prices.length ? prices.map((price, index) => <div className="price-line" key={`${price.fareType}-${index}`}>
    <span>{price.fareType === 'REDUCED' ? 'Ulgowa' : 'Normalna'}: <strong>{price.status === 'KNOWN' && price.amount !== null ? money(price.amount, price.currency) : price.status === 'PROVIDER_ERROR' ? 'Błąd źródła ceny' : 'Cena niepotwierdzona'}</strong></span>
    {!compact && <>
      {price.basis === 'PUBLISHED_TARIFF' && <small className="warning-text">Taryfa publikowana — nie jest wyceną konkretnej rezerwacji.</small>}
      {price.basis === 'LIVE_OFFER' && <small>Oferta wyceniona dla wskazanego terminu.</small>}
      {price.basis === 'TEST_DATA' && <small>Przykładowa cena testowa.</small>}
      {price.eligibility && <small>Warunki ulgi: {price.eligibility}</small>}
      {price.reason && <small>{price.reason}</small>}
      {price.checkedAt && <small>Sprawdzono: {moment(price.checkedAt)}</small>}
      <small><ExternalLink href={price.sourceUrl}>Źródło ceny</ExternalLink></small>
    </>}
  </div>) : <span className="warning-text">Cena niepotwierdzona</span>}</div>;
}

const scheduleDate = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'medium' });
const scheduleTimestamp = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'medium', timeStyle: 'short' });

function ScheduleTime({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return null;
  const formatter = /^\d{4}-\d{2}-\d{2}$/.test(value) ? scheduleDate : scheduleTimestamp;
  return <span>{label} <time dateTime={value}>{formatter.format(time)}</time></span>;
}

export function SegmentSchedule({ segment }: { segment: Segment }) {
  const { scheduleBasis, schedulePublishedAt, scheduleCheckedAt } = segment;
  if (!scheduleBasis && !schedulePublishedAt && !scheduleCheckedAt) return null;
  return <div className="schedule-provenance">
    {scheduleBasis && <span>{scheduleBasis === 'REALTIME' ? 'Aktualizacja na żywo' : 'Rozkład planowany'}</span>}
    <ScheduleTime label="Publikacja" value={schedulePublishedAt} />
    <ScheduleTime label="Sprawdzono" value={scheduleCheckedAt} />
  </div>;
}

export function SegmentLinks({ segment, showDiscovery = false }: { segment: Segment; showDiscovery?: boolean }) {
  return <div className="inline-links">
    <ExternalLink href={segment.bookingUrl}>Strona przewoźnika</ExternalLink>
    <ExternalLink href={segment.mapUrl}>Otwórz mapę</ExternalLink>
    <ExternalLink href={segment.scheduleSourceUrl}>Źródło rozkładu</ExternalLink>
    {showDiscovery && <ExternalLink href={segment.discoverySourceUrl}>Źródło znalezione przez AI</ExternalLink>}
  </div>;
}

export function SegmentPrices({ segment, compact }: { segment: Segment; compact?: boolean }) {
  if (segment.scheduleBasis && !segment.prices.length) {
    return <div className="prices"><span className="warning-text">Cena niedostępna</span></div>;
  }
  return <Prices prices={segment.prices} compact={compact} />;
}

const modes: Record<string, string> = { TRAIN: 'Pociąg', PLANE: 'Samolot', COACH: 'Autokar', FERRY: 'Prom', LOCAL_TRANSIT: 'Komunikacja miejska', WALK: 'Pieszo' };
export function JourneyDetails({ journey, label }: { journey: Journey; label: string }) {
  return <section className="journey" aria-label={label}>
    <h4>{label}</h4>
    <p className="journey-times">{moment(journey.departureAt)} <span aria-hidden="true">→</span> {moment(journey.arrivalAt)}</p>
    <ol className="segments">
      {journey.segments.map((segment) => <li key={segment.id}>
        <strong>{modes[segment.mode] || segment.mode} · {segment.operator}</strong>
        <p>{segment.origin.name} → {segment.destination.name}</p>
        <p className="muted">{moment(segment.departureAt)} — {moment(segment.arrivalAt)}</p>
        <SegmentPrices segment={segment} />
        <SegmentSchedule segment={segment} />
        <SegmentLinks segment={segment} />
      </li>)}
    </ol>
  </section>;
}
export function TripMetrics({ trip }: { trip: RoundTrip }) {
  return <div className="metrics">
    <span>{duration(trip.travelMinutes)} w podróży</span>
    <span>Przesiadki: {trip.transfers}</span>
    <span>{duration(trip.timeAtDestinationMinutes)} na miejscu</span>
  </div>;
}
export function TripDetails({ trip }: { trip: RoundTrip }) { return <div className="trip-details"><TripMetrics trip={trip} /><JourneyDetails journey={trip.outbound} label="Wyjazd" /><JourneyDetails journey={trip.returnJourney} label="Powrót" /></div>; }
export function ReadOnlyPlan({ plan }: { plan: Plan }) { return <><div className="section-heading"><div><p className="eyebrow">TWÓJ CZAS W MIEŚCIE</p><h2>{plan.criteria.origin} <span aria-hidden="true">→</span> {plan.criteria.destination}</h2><p>{plan.criteria.departureDate} — {plan.criteria.returnDate}</p></div><span className="readonly-badge">Tylko do odczytu</span></div>{plan.testData && <TestBanner />}<div className="public-layout"><section className="panel"><h3>Podróż w obie strony</h3><Cost summary={plan.costSummary} /><TripDetails trip={plan.selectedRoundTrip} /></section><section className="panel"><h3>Plan zwiedzania</h3>{plan.items.length === 0 ? <p>W tym planie nie wybrano jeszcze atrakcji.</p> : <ol className="schedule">{plan.items.map((item) => <li key={item.id}><h4>{item.name}</h4><p>{moment(item.startsAt)} — {moment(item.endsAt)}</p><p className="muted">{item.transferMinutesFromPrevious === null ? 'Brak potwierdzonego czasu dojazdu' : `Dojazd / dojście: ${duration(item.transferMinutesFromPrevious)}`}</p>{item.conflicts.length > 0 && <ul className="conflicts" aria-label={`Konflikty: ${item.name}`}>{item.conflicts.map((conflict, index) => <li key={`${conflict.code}-${index}`}>{conflict.reason}</li>)}</ul>}</li>)}</ol>}</section></div></>; }
