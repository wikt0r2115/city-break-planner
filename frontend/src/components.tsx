import type { CostSummary, Journey, Plan, Price, RoundTrip } from './types';
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
const modes: Record<string, string> = { TRAIN: 'Pociąg', PLANE: 'Samolot', COACH: 'Autokar', FERRY: 'Prom', LOCAL_TRANSIT: 'Komunikacja miejska', WALK: 'Pieszo' };
export function JourneyDetails({ journey, label }: { journey: Journey; label: string }) { return <section className="journey" aria-label={label}><h4>{label}</h4><p className="journey-times">{moment(journey.departureAt)} <span aria-hidden="true">→</span> {moment(journey.arrivalAt)}</p><ol className="segments">{journey.segments.map((segment) => <li key={segment.id}><strong>{modes[segment.mode] || segment.mode} · {segment.operator}</strong><p>{segment.origin.name} → {segment.destination.name}</p><p className="muted">{moment(segment.departureAt)} — {moment(segment.arrivalAt)}</p><Prices prices={segment.prices} /><div className="inline-links"><ExternalLink href={segment.bookingUrl}>Strona przewoźnika</ExternalLink><ExternalLink href={segment.mapUrl}>Otwórz mapę</ExternalLink></div></li>)}</ol></section>; }
export function TripDetails({ trip }: { trip: RoundTrip }) { return <div className="trip-details"><div className="metrics"><span>{duration(trip.travelMinutes)} w podróży</span><span>{trip.transfers} przesiadek</span><span>{duration(trip.timeAtDestinationMinutes)} na miejscu</span></div><JourneyDetails journey={trip.outbound} label="Wyjazd" /><JourneyDetails journey={trip.returnJourney} label="Powrót" /></div>; }
export function ReadOnlyPlan({ plan }: { plan: Plan }) { return <><div className="section-heading"><div><p className="eyebrow">TWÓJ CZAS W MIEŚCIE</p><h2>{plan.criteria.origin} <span aria-hidden="true">→</span> {plan.criteria.destination}</h2><p>{plan.criteria.departureDate} — {plan.criteria.returnDate}</p></div><span className="readonly-badge">Tylko do odczytu</span></div>{plan.testData && <TestBanner />}<div className="public-layout"><section className="panel"><h3>Podróż w obie strony</h3><Cost summary={plan.costSummary} /><TripDetails trip={plan.selectedRoundTrip} /></section><section className="panel"><h3>Plan zwiedzania</h3>{plan.items.length === 0 ? <p>W tym planie nie wybrano jeszcze atrakcji.</p> : <ol className="schedule">{plan.items.map((item) => <li key={item.id}><h4>{item.name}</h4><p>{moment(item.startsAt)} — {moment(item.endsAt)}</p><p className="muted">{item.transferMinutesFromPrevious === null ? 'Brak potwierdzonego czasu dojazdu' : `Dojazd / dojście: ${duration(item.transferMinutesFromPrevious)}`}</p>{item.conflicts.length > 0 && <ul className="conflicts" aria-label={`Konflikty: ${item.name}`}>{item.conflicts.map((conflict, index) => <li key={`${conflict.code}-${index}`}>{conflict.reason}</li>)}</ul>}</li>)}</ol>}</section></div></>; }
