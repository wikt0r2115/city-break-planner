// Controlled test responses. No live schedules, dates, or fares are represented here.
import type { Attraction, Criteria, ItemInput, Plan, PlanInput, Price, RoundTrip, SearchResult } from '../types';
export const criteria: Criteria = { origin: 'Warszawa', destination: 'Gdańsk', departureDate: '2099-12-05', returnDate: '2099-12-06', priority: 'LOWEST_TOTAL_COST', currency: 'PLN', fareType: 'STANDARD' };
export const price: Price = { status: 'KNOWN', amount: '49.90', currency: 'PLN', fareType: 'STANDARD', eligibility: null, sourceId: 'test-source', sourceUrl: 'https://example.com/test-fare', checkedAt: '2099-12-01T10:00:00Z', testData: true };
const outbound = { departureAt: '2099-12-05T07:00:00+01:00', arrivalAt: '2099-12-05T10:00:00+01:00', segments: [{ id: 'test-out', mode: 'TRAIN', operator: 'Testowy przewoźnik', origin: { name: 'Warszawa', latitude: null, longitude: null }, destination: { name: 'Gdańsk', latitude: null, longitude: null }, departureAt: '2099-12-05T07:00:00+01:00', arrivalAt: '2099-12-05T10:00:00+01:00', prices: [price, { ...price, fareType: 'REDUCED' as const, amount: '24.45', eligibility: 'Testowa ulga dla studentów.' }], bookingUrl: 'https://example.com/booking', mapUrl: 'https://example.com/map' }] };
export const regularTrip: RoundTrip = { id: 'test-regular', outbound, returnJourney: { ...outbound, departureAt: '2099-12-06T18:00:00+01:00', arrivalAt: '2099-12-06T21:00:00+01:00', segments: [{ ...outbound.segments[0], id: 'test-back', departureAt: '2099-12-06T18:00:00+01:00', arrivalAt: '2099-12-06T21:00:00+01:00' }] }, travelMinutes: 360, transfers: 0, timeAtDestinationMinutes: 1920, costSummary: { total: '119.80', currency: 'PLN', fareType: 'STANDARD', complete: true, missingComponents: [] }, recommendedAttractionIds: ['test-museum'] };
export const earlyTrip: RoundTrip = { ...regularTrip, id: 'test-early', returnJourney: { ...regularTrip.returnJourney, departureAt: '2099-12-06T10:30:00+01:00' }, costSummary: { ...regularTrip.costSummary, total: null, complete: false, missingComponents: ['test-back'] } };
export const attractions: Attraction[] = ['museum', 'gallery', 'park'].map((name, index) => ({ id: `test-${name}`, name: ['Muzeum testowe', 'Galeria testowa', 'Park testowy'][index], location: { name: 'Gdańsk', latitude: null, longitude: null }, visitMinutes: [90, 60, 45][index], entryPrices: [{ ...price, amount: '20.00' }], openingHours: { status: 'KNOWN', intervals: [{ opensAt: '2099-12-06T09:00:00+01:00', closesAt: '2099-12-06T18:00:00+01:00' }] }, sources: [] }));
export const result: SearchResult = { searchId: 'test-search', criteria, status: 'PARTIAL', roundTripOptions: [regularTrip, earlyTrip], attractions, sources: [{ sourceId: 'test-source', url: 'https://example.com/source', checkedAt: '2099-12-01T10:00:00Z', status: 'OK', message: 'Przykładowe dane testowe.' }], testData: true };
export function planFor(input?: PlanInput): Plan {
  const trip = input?.selectedRoundTrip || regularTrip;
  const items: ItemInput[] = input?.items || [{ id: 'test-item', attractionId: 'test-museum', startsAt: '2099-12-06T11:00:00+01:00', visitMinutes: 90 }];
  const scheduled = items.map((item, index) => {
    const startsAt = item.startsAt ?? `2099-12-06T${index ? '14' : '11'}:00:00+01:00`;
    return {
      id: item.id,
      attractionId: item.attractionId,
      name: attractions.find((attraction) => attraction.id === item.attractionId)!.name,
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + item.visitMinutes * 60000).toISOString(),
      transferMinutesFromPrevious: 20,
      conflicts: trip.id === earlyTrip.id ? [{ code: 'RETURN_DEPARTURE', reason: 'Nie zdążysz na wcześniejszy powrót po tej wizycie.', itemId: item.id }] : [],
      automaticTime: input ? (item.automaticTime ?? item.startsAt === null) : undefined,
    };
  });
  return {
    id: null, criteria: input?.criteria || criteria, selectedRoundTrip: trip, items: scheduled,
    costSummary: trip.costSummary, createdAt: null, updatedAt: null, testData: true,
  };
}
export const savedPlan: Plan = { ...planFor(), id: 'saved-test', shareUrl: 'http://localhost:5173/shared/test-public-token', createdAt: '2099-12-01T10:00:00Z', updatedAt: '2099-12-01T10:00:00Z' };
