import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AttractionPicker } from './AttractionPicker';
import { attractions } from './test/fixtures';

describe('kompaktowy wybór atrakcji', () => {
  it('pokazuje jedną atrakcję naraz, zachowuje kontrolki i nie pobiera rekomendacji przy stronicowaniu', () => {
    const onRecommend = vi.fn().mockResolvedValue(null); const onAdd = vi.fn();
    render(<AttractionPicker attractions={attractions} selected={[]} disabled={false} contextKey="one-trip" onRecommend={onRecommend} onAdd={onAdd} compact />);
    expect(screen.getByRole('heading', { name: 'Muzeum testowe' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Galeria testowa' })).not.toBeInTheDocument();
    expect(screen.getByText('Atrakcja 1 z 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Poprzednia atrakcja' })).toBeDisabled();
    expect(screen.getByText('Dobierz atrakcje').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Następna atrakcja' }));
    expect(screen.getByRole('heading', { name: 'Galeria testowa' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj: Galeria testowa' }));
    expect(onAdd).toHaveBeenCalledWith(attractions[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Następna atrakcja' }));
    expect(screen.getByRole('button', { name: 'Następna atrakcja' })).toBeDisabled();
    expect(onRecommend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Dobierz atrakcje'));
    expect(screen.getByText('Dobierz atrakcje').closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Zaproponuj atrakcje' })).toBeInTheDocument();
  });

  it('resetuje stronę po zmianie podróży i zachowuje dotychczasowy pełny widok bez compact', () => {
    const props = { attractions, selected: [], disabled: false, contextKey: 'trip-1', onRecommend: vi.fn().mockResolvedValue(null), onAdd: vi.fn() };
    const { rerender } = render(<AttractionPicker {...props} compact />);
    fireEvent.click(screen.getByRole('button', { name: 'Następna atrakcja' }));
    rerender(<AttractionPicker {...props} contextKey="trip-2" compact />);
    expect(screen.getByText('Atrakcja 1 z 3')).toBeInTheDocument();
    rerender(<AttractionPicker {...props} />);
    expect(screen.getByRole('heading', { name: 'Muzeum testowe' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Galeria testowa' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Strony atrakcji' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zaproponuj atrakcje' })).toBeInTheDocument();
  });
});
