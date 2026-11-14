import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCachedStay, readStaySession, rememberStayForm, rememberStayResult, STAY_CACHE_MAX_BYTES, STAY_SESSION_KEY, stayExpiry } from './staySessionCache';
import type { StayCriteria, StayResult } from './types';

const criteria: StayCriteria = { destination: 'Paryż', checkIn: '2026-12-05', checkOut: '2026-12-07', adults: 2, currency: 'PLN' };
const context = 'controlled-travel-context';
function quote(input = criteria): StayResult {
  const quotedAt = new Date().toISOString(); const expiresAt = new Date(Date.now() + 3600000).toISOString();
  return { status: 'OK', source: 'OBO Travel', checkedAt: quotedAt, expiresAt, criteria: input, message: null, retryAfterSeconds: null,
    hotels: [{ hotelToken: 'test-only-quote', name: 'Hotel kontrolowany', stars: null, totalPrice: '400.00', nightlyPrice: '200.00', currency: input.currency,
      bookingUrl: 'https://onebookingonline.com/offer', taxesIncluded: null, feesIncluded: null, extraCharges: [], inclusionsNote: null,
      quotedAt, expiresAt, photoUrl: 'https://onebookingonline.com/hotel.jpg', location: { latitude: 48.86, longitude: 2.34 } }] };
}
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime('2026-11-14T10:00:00Z'); });
afterEach(() => vi.useRealTimers());

describe('cache noclegów w bieżącej karcie', () => {
  it('przywraca kryteria i wynik bez zmiany oryginalnego czasu ważności', () => {
    const result = quote(); rememberStayResult(context, result);
    expect(stayExpiry(result)).toBe(Date.parse('2026-11-14T10:30:00Z'));
    const savedAt = JSON.parse(sessionStorage.getItem(STAY_SESSION_KEY)!).entries[0].savedAt;
    vi.setSystemTime('2026-11-14T10:20:00Z');
    expect(readStaySession(context, { ...criteria, adults: 1 })).toMatchObject({ criteria, result, expired: false });
    expect(JSON.parse(sessionStorage.getItem(STAY_SESSION_KEY)!).entries[0].savedAt).toBe(savedAt);
    vi.setSystemTime('2026-11-14T10:30:00.001Z');
    expect(readStaySession(context, criteria)).toMatchObject({ result: null, expired: true });
    expect(JSON.parse(sessionStorage.getItem(STAY_SESSION_KEY)!).entries).toHaveLength(0);
    expect(localStorage.length).toBe(0);
  });

  it('respektuje wcześniejsze expiresAt i wiąże wynik z każdym parametrem oraz kontekstem', () => {
    const result = quote(); result.hotels[0].expiresAt = '2026-11-14T10:00:30Z';
    rememberStayResult(context, result);
    expect(readCachedStay(context, criteria)).toEqual(result);
    expect(readCachedStay('other-travel-context', criteria)).toBeNull();
    for (const changed of [{ adults: 3 }, { destination: 'Londyn' }, { checkIn: '2026-12-04' }, { checkOut: '2026-12-08' }, { currency: 'EUR' as const }]) {
      expect(readCachedStay(context, { ...criteria, ...changed })).toBeNull();
    }
    vi.advanceTimersByTime(30001);
    expect(readCachedStay(context, criteria)).toBeNull();
  });

  it('zachowuje pierwotny limit savedAt również przy późniejszym zegarze dostawcy', () => {
    const response = quote();
    response.checkedAt = '2026-11-14T10:05:00Z'; response.hotels[0].quotedAt = response.checkedAt;
    rememberStayResult(context, response);
    vi.setSystemTime('2026-11-14T10:20:00Z');
    const restored = readCachedStay(context, criteria)!;
    expect(stayExpiry(restored)).toBe(Date.parse('2026-11-14T10:30:00Z'));
  });

  it('ogranicza cache do trzech wyników i trzech formularzy oraz 100 KB', () => {
    for (let index = 0; index < 5; index++) rememberStayResult(`context-${index}`, quote({ ...criteria, adults: index + 1 }));
    let stored = JSON.parse(sessionStorage.getItem(STAY_SESSION_KEY)!);
    expect(stored.entries).toHaveLength(3); expect(stored.forms).toHaveLength(3);
    expect(stored.entries[0].context).toBe('context-4');
    const large = quote(); large.hotels[0].inclusionsNote = 'a'.repeat(STAY_CACHE_MAX_BYTES);
    rememberStayResult(context, large);
    const raw = sessionStorage.getItem(STAY_SESSION_KEY)!;
    expect(raw.length * 2).toBeLessThanOrEqual(STAY_CACHE_MAX_BYTES);
    stored = JSON.parse(raw); expect(stored.entries.length).toBeLessThanOrEqual(3);
  });

  it.each(['invalid JSON', JSON.stringify({ version: 999, entries: [], forms: [] }), 'a'.repeat(STAY_CACHE_MAX_BYTES)])('usuwa uszkodzoną, starą lub za dużą zawartość', (raw) => {
    sessionStorage.setItem(STAY_SESSION_KEY, raw);
    expect(readStaySession(context, criteria)).toMatchObject({ criteria, result: null });
    expect(sessionStorage.getItem(STAY_SESSION_KEY)).toBeNull();
  });

  it('ponownie waliduje waluty, lokalizacje i kryteria z sessionStorage', () => {
    const corruptions = [
      (entry: any) => { entry.result.hotels[0].currency = 'not-a-currency'; },
      (entry: any) => { entry.result.hotels[0].location.latitude = 99; },
      (entry: any) => { entry.result.criteria.adults = 99; },
      (entry: any) => { entry.result.criteria.destination = 'Londyn'; },
      (entry: any) => { entry.savedAt = Date.now() + 1000; },
    ];
    for (const corrupt of corruptions) {
      rememberStayResult(context, quote());
      const envelope = JSON.parse(sessionStorage.getItem(STAY_SESSION_KEY)!);
      corrupt(envelope.entries[0]); sessionStorage.setItem(STAY_SESSION_KEY, JSON.stringify(envelope));
      expect(readCachedStay(context, criteria)).toBeNull();
    }
  });

  it('nie zapisuje błędów, limitów ani pustej listy bez ważnej wyceny', () => {
    for (const status of ['PROVIDER_ERROR', 'RATE_LIMITED', 'UNAVAILABLE', 'EMPTY'] as const) {
      rememberStayResult(context, { ...quote(), status, hotels: [], expiresAt: null });
      expect(readCachedStay(context, criteria)).toBeNull();
    }
    rememberStayForm(context, { ...criteria, adults: 3 });
    expect(readStaySession(context, criteria).criteria.adults).toBe(3);
  });
});
