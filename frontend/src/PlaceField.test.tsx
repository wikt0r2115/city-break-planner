import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from './App';
import type { PlaceCatalog } from './types';

const live: PlaceCatalog = {
  places: [
    { value: 'Dworzec Główny', label: 'Dworzec Główny, Gdańsk' },
    { value: 'Targ Rybny', label: 'Targ Rybny, Gdańsk' },
  ],
  testData: false,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const searchResult = { roundTripOptions: [], attractions: [], sources: [], status: 'NO_CONNECTION', testData: false };

it.each([
  ['Miejsce startu', 'Cel podróży', 'Dworzec Główny', 'Targ Rybny'],
  ['Cel podróży', 'Miejsce startu', 'Dworzec Główny', 'Targ Rybny'],
])('podpowiada %s, wyklucza to samo miejsce w drugim polu i wysyła wartości katalogowe', async (first, second, chosen, remaining) => {
  const fetch = vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url.endsWith('/places')) return json(live);
    if (url.endsWith('/searches')) return json({ ...searchResult, criteria: JSON.parse(String(options.body)) });
    throw new Error(url);
  });
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  const firstInput = screen.getByRole('combobox', { name: first });
  fireEvent.change(firstInput, { target: { value: '  dWoRzEc   glowny  ' } });
  expect(await screen.findByRole('option', { name: /Dworzec Główny/ })).toBeInTheDocument();
  fireEvent.keyDown(firstInput, { key: 'ArrowDown' });
  expect(firstInput).toHaveAttribute('aria-activedescendant', expect.stringContaining('-place-'));
  fireEvent.keyDown(firstInput, { key: 'Enter' });
  expect(firstInput).toHaveValue(chosen);
  expect(firstInput).toHaveAttribute('aria-expanded', 'false');

  const secondInput = screen.getByRole('combobox', { name: second });
  fireEvent.focus(secondInput);
  const list = screen.getByRole('listbox', { name: second });
  expect(within(list).queryByRole('option', { name: /Dworzec Główny/ })).not.toBeInTheDocument();
  fireEvent.click(within(list).getByRole('option', { name: /Targ Rybny/ }));
  expect(secondInput).toHaveValue(remaining);
  fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
  await screen.findByRole('heading', { name: 'Brak potwierdzonych połączeń' });

  const search = fetch.mock.calls.find(([url]) => url.endsWith('/searches'));
  expect(JSON.parse(String(search?.[1]?.body))).toMatchObject(first === 'Miejsce startu'
    ? { origin: chosen, destination: remaining }
    : { origin: remaining, destination: chosen });
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/places'))).toHaveLength(1);
});

it('filtruje najnowszy wpis po opóźnionym pobraniu katalogu i zamyka listę klawiszem Escape', async () => {
  let resolveCatalog!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveCatalog = resolve; })));
  render(<App />);
  const input = screen.getByRole('combobox', { name: 'Miejsce startu' });
  fireEvent.change(input, { target: { value: 'dwor' } });
  fireEvent.change(input, { target: { value: 'RYB' } });
  expect(screen.getByText('Wczytywanie podpowiedzi…')).toBeInTheDocument();
  await act(async () => { resolveCatalog(json(live)); });
  expect(screen.getByRole('option', { name: /Targ Rybny/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Dworzec Główny/ })).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveValue('RYB');
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('oznacza przykładowe sugestie i przyjmuje własną nazwę w trybie demo', async () => {
  const fetch = vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url.endsWith('/places')) return json({ places: [{ value: 'Gdańsk', label: 'Gdańsk' }], testData: true });
    if (url.endsWith('/searches')) return json({ ...searchResult, criteria: JSON.parse(String(options.body)), testData: true });
    throw new Error(url);
  });
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  const origin = screen.getByRole('combobox', { name: 'Miejsce startu' });
  fireEvent.focus(origin);
  const suggestion = await screen.findByRole('option', { name: /Gdańsk/ });
  expect(within(suggestion).getByText('Przykład testowy')).toBeInTheDocument();
  fireEvent.change(origin, { target: { value: 'Opole' } });
  expect(screen.getByText('Brak pasujących podpowiedzi.')).toBeInTheDocument();
  fireEvent.blur(origin);
  fireEvent.change(screen.getByRole('combobox', { name: 'Cel podróży' }), { target: { value: 'Poznań' } });
  fireEvent.click(screen.getByRole('button', { name: /Znajdź połączenia/ }));
  await screen.findByRole('heading', { name: 'Brak potwierdzonych połączeń' });
  const search = fetch.mock.calls.find(([url]) => url.endsWith('/searches'));
  expect(JSON.parse(String(search?.[1]?.body))).toMatchObject({ origin: 'Opole', destination: 'Poznań' });
});

it.each([
  [() => json({ places: [], testData: false }), 'Brak dostępnych podpowiedzi.'],
  [() => json({ detail: 'Błąd katalogu' }, 503), 'Podpowiedzi są chwilowo niedostępne.'],
])('obsługuje pusty lub niedostępny katalog', async (response, hint) => {
  vi.stubGlobal('fetch', vi.fn(async () => response()));
  render(<App />);
  const input = screen.getByRole('combobox', { name: 'Cel podróży' });
  fireEvent.focus(input);
  expect(await screen.findByText(hint)).toBeInTheDocument();
  expect(input).toHaveAttribute('aria-expanded', 'false');
});
