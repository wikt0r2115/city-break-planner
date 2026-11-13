import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripResults } from './TripResults';
import { regularTrip, result } from './test/fixtures';

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
