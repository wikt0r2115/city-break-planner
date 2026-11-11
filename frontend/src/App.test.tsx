import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App, { HEALTH_TIMEOUT_MS } from './App';

function up() { return new Response(JSON.stringify({ status: 'UP', database: 'UP' }), { status: 200 }); }

describe('połączenie z działającym API', () => {
  it('pokazuje ładowanie i dopiero po potwierdzeniu API zgłasza gotowość', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Sprawdzamy połączenie');
    expect(screen.getByRole('button')).toBeDisabled();
    await act(async () => { resolve(up()); });
    expect(screen.getByRole('status')).toHaveTextContent('Połączenie potwierdzone');
    expect(fetch).toHaveBeenCalledWith('http://localhost:8080/api/v1/health', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('po błędzie HTTP pozwala ponowić sprawdzenie i odzyskać połączenie', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: 'DOWN', database: 'DOWN' }), { status: 503 })).mockResolvedValueOnce(up());
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    expect(await screen.findByText('Nie udało się połączyć')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź ponownie' }));
    expect(await screen.findByText('Połączenie potwierdzone')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('nie traktuje pustej odpowiedzi jako potwierdzenia gotowości', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    render(<App />);
    expect(await screen.findByText(/nieprawidłową odpowiedź/)).toBeInTheDocument();
  });

  it('kończy zbyt długie żądanie i pozwala spróbować ponownie', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS); });
    expect(screen.getByRole('status')).toHaveTextContent('Sprawdzanie trwało zbyt długo');
    expect(screen.getByRole('button')).toBeEnabled();
  });
});
