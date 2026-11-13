import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripDetails } from './components';
import { TripResults } from './TripResults';
import { regularTrip, result } from './test/fixtures';
import type { RoundTrip, SearchResult, Segment } from './types';

const trips = Array.from({ length: 7 }, (_, index) => ({ ...regularTrip, id: String(index + 1) }));
const manyResults = { ...result, roundTripOptions: trips };

describe('stronicowane warianty połączeń', () => {
  it.each([[false, 2, 4], [true, 3, 3]])('pokazuje właściwą liczbę kart (szeroki ekran: %s)', (wide, size, pages) => {
    vi.stubGlobal('matchMedia', () => ({
      matches: wide,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const onSelect = vi.fn();
    render(<TripResults result={manyResults} selectedId={trips[0].id} busy={false} onSelect={onSelect} />);
    const previous = screen.getByRole('button', { name: 'Poprzednia' });
    const next = screen.getByRole('button', { name: 'Następna' });
    expect(previous).toBeDisabled();
    expect(screen.getAllByRole('article')).toHaveLength(size);
    expect(screen.getByRole('status')).toHaveTextContent(`Strona 1 z ${pages}`);
    expect(screen.getByRole('button', { name: /^Wariant 1,/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(next);
    expect(screen.getByRole('status')).toHaveTextContent(`Strona 2 z ${pages}`);
    expect(screen.getAllByRole('article')).toHaveLength(size);
    expect(screen.getByRole('button', { name: new RegExp(`^Wariant ${size + 1},`) })).toBeInTheDocument();
    fireEvent.click(previous);
    expect(screen.getByRole('button', { name: /^Wariant 1,/ })).toHaveAttribute('aria-pressed', 'true');
    expect(onSelect).not.toHaveBeenCalled();

    for (let index = 1; index < pages; index += 1) fireEvent.click(next);
    expect(next).toBeDisabled();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it.each([0, 1])('nie pokazuje paginacji dla %s wariantów', (count) => {
    render(<TripResults result={{ ...result, roundTripOptions: trips.slice(0, count) }} busy={false} onSelect={vi.fn()} />);
    expect(screen.queryAllByRole('article')).toHaveLength(count);
    expect(screen.queryByRole('navigation', { name: 'Strony wyników' })).not.toBeInTheDocument();
  });

  it('wybiera kartę i pozostawia linki niezależne od wyboru', () => {
    const onSelect = vi.fn();
    render(<TripResults result={manyResults} selectedId={trips[0].id} busy={false} onSelect={onSelect} />);
    const card = within(screen.getAllByRole('article')[1]);
    for (const [name, url] of [['Strona przewoźnika', 'https://example.com/booking'], ['Otwórz mapę', 'https://example.com/map']]) {
      const link = card.getAllByRole('link', { name })[0];
      expect(link).toHaveAttribute('href', url);
      expect(link).toHaveAttribute('target', '_blank');
      link.addEventListener('click', (event) => event.preventDefault());
      fireEvent.click(link);
    }
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(card.getByRole('button', { name: /^Wariant 2,/ }));
    expect(onSelect).toHaveBeenCalledWith(trips[1]);
    expect(screen.queryByText('Przykładowe dane testowe.')).not.toBeInTheDocument();
    expect(card.queryByText(/Warunki ulgi|Sprawdzono/)).not.toBeInTheDocument();
  });
});

describe('pilotaż rozkładów kolejowych', () => {
  const railSegment: Segment = {
    ...regularTrip.outbound.segments[0],
    origin: { name: 'Gdańsk Główny', latitude: null, longitude: null },
    destination: { name: 'Wejherowo', latitude: null, longitude: null },
    operator: 'PKP Szybka Kolej Miejska w Trójmieście Sp. z o.o.',
    prices: [],
    scheduleBasis: 'PLANNED',
    scheduleSourceUrl: 'https://example.com/open-data',
    schedulePublishedAt: '2099-12-01',
    scheduleCheckedAt: '2099-12-02T13:00:00+01:00',
  };
  const railTrip: RoundTrip = {
    ...regularTrip,
    outbound: { ...regularTrip.outbound, segments: [railSegment] },
    returnJourney: { ...regularTrip.returnJourney, segments: [{
      ...railSegment,
      id: 'rail-return',
      origin: railSegment.destination,
      destination: railSegment.origin,
      scheduleBasis: 'REALTIME',
      schedulePublishedAt: null,
    }] },
    costSummary: { ...regularTrip.costSummary, total: null, complete: false, missingComponents: ['rail'] },
  };
  const source = (reasonCode: string) => ({ ...result.sources[0], reasonCode });

  it('pokazuje stacje, metryki, pochodzenie i rodzaj rozkładu przy dostępnych kursach', () => {
    render(<TripResults result={{ ...result, roundTripOptions: [railTrip], sources: [source('UPSTREAM_FAILURE')] }} busy={false} onSelect={vi.fn()} />);
    const outbound = within(screen.getByRole('region', { name: 'Wyjazd' }));
    expect(outbound.getByText('Gdańsk Główny → Wejherowo')).toBeInTheDocument();
    expect(outbound.getByText(railSegment.operator)).toBeInTheDocument();
    expect(outbound.getByText('Rozkład planowany')).toBeInTheDocument();
    expect(outbound.getByText('1 gru 2099')).toHaveAttribute('datetime', '2099-12-01');
    expect(outbound.getByText('Cena niedostępna')).toBeInTheDocument();
    expect(outbound.getByRole('link', { name: 'Źródło rozkładu' })).toHaveAttribute('href', railSegment.scheduleSourceUrl);
    const inbound = within(screen.getByRole('region', { name: 'Powrót' }));
    expect(inbound.getByText('Aktualizacja na żywo')).toBeInTheDocument();
    expect(inbound.getByText('Sprawdzono', { exact: false })).toBeInTheDocument();
    expect(inbound.queryByRole('link', { name: 'Źródło znalezione przez AI' })).not.toBeInTheDocument();
    expect(screen.getByText('6 h w podróży')).toBeInTheDocument();
    expect(screen.getByText('Przesiadki: 0')).toBeInTheDocument();
    expect(screen.getByText('32 h na miejscu')).toBeInTheDocument();
    expect(screen.queryByText('Wyszukiwanie AI jest chwilowo niedostępne')).not.toBeInTheDocument();
  });

  it('w udostępnionym planie pokazuje zweryfikowany rozkład bez linku odkrytego przez AI', () => {
    render(<TripDetails trip={railTrip} />);
    expect(screen.getAllByRole('link', { name: 'Źródło rozkładu' })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Źródło znalezione przez AI' })).not.toBeInTheDocument();
  });

  it.each<[SearchResult['status'], string, string]>([
    ['PARTIAL', 'AMBIGUOUS_PLACE', 'Doprecyzuj miejsce'],
    ['PARTIAL', 'UNSUPPORTED_ROUTE', 'Trasa poza zakresem planera'],
    ['PARTIAL', 'OUTSIDE_COVERAGE', 'Brak rozkładu dla wybranych dat'],
    ['PROVIDER_ERROR', 'UPSTREAM_FAILURE', 'Nie udało się sprawdzić połączeń'],
    ['PROVIDER_ERROR', 'UPSTREAM_FAILURE', 'Nie udało się sprawdzić połączeń'],
  ])('pokazuje przyczynę pustego wyniku %s/%s', (status, reason, title) => {
    render(<TripResults result={{ ...result, status, roundTripOptions: [], sources: [source(reason)] }} busy={false} onSelect={vi.fn()} />);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  });
});
