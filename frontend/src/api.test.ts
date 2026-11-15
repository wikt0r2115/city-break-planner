import { describe, expect, it, vi } from 'vitest';
import { ApiError, suggestAttractions } from './api';
import { criteria } from './test/fixtures';

describe('kontrakt rekomendacji katalogowych', () => {
  it.each([
    { suggestions: [{ attractionId: 'test-gallery', reason: 'Pasuje do zainteresowań.' }] },
    { suggestions: [] },
  ])('odczytuje odpowiedź katalogu bez dodatkowej flagi dostawcy: %j', async (response) => {
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(suggestAttractions(criteria, 'selected-trip', 'CULTURE', 0)).resolves.toEqual(response);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/recommendations$/);
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({ criteria, roundTripId: 'selected-trip', interest: 'CULTURE', budgetPln: 0 });
  });

  it.each([
    ['brak listy', {}],
    ['lista zamiast obiektu', []],
    ['niepoprawny identyfikator', { suggestions: [{ attractionId: 42, reason: 'Powód.' }] }],
    ['brak powodu', { suggestions: [{ attractionId: 'test-gallery' }] }],
  ])('odrzuca uszkodzoną odpowiedź: %s', async (_name, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })));

    await expect(suggestAttractions(criteria, 'selected-trip', 'MIXED', 150))
      .rejects.toThrow(new ApiError('Nie udało się odczytać propozycji atrakcji.'));
  });
});
