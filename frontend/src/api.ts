import type { Criteria, Interest, PlaceCatalog, Plan, PlanInput, Recommendations, SearchResult, StayCriteria, StayResult } from './types';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 10000;
export const SEARCH_TIMEOUT_MS = 25000;
export class ApiError extends Error {
  constructor(message: string, public readonly status = 0, public readonly errors: { field: string; message: string }[] = []) { super(message); }
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function isPlan(body: unknown): body is Plan { return record(body) && record(body.criteria) && record(body.selectedRoundTrip) && record(body.costSummary) && Array.isArray(body.items); }
function isSearch(body: unknown): body is SearchResult { return record(body) && record(body.criteria) && ['OK', 'PARTIAL', 'NO_CONNECTION', 'PROVIDER_ERROR'].includes(String(body.status)) && Array.isArray(body.roundTripOptions) && Array.isArray(body.attractions) && Array.isArray(body.sources); }
function isPlaceCatalog(body: unknown): body is PlaceCatalog {
  return record(body) && typeof body.testData === 'boolean' && Array.isArray(body.places)
    && body.places.every((place) => record(place) && typeof place.value === 'string' && typeof place.label === 'string');
}

async function request(path: string, method: string, body?: unknown, token?: string, signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method, signal: controller.signal, cache: 'no-store',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return null;
    let data: unknown;
    try { data = await response.json(); } catch { throw new ApiError('Aplikacja zwróciła nieprawidłową odpowiedź. Spróbuj ponownie.', response.status); }
    if (!response.ok) {
      const errors = record(data) && Array.isArray(data.errors) ? data.errors.filter((e): e is { field: string; message: string } => record(e) && typeof e.field === 'string' && typeof e.message === 'string') : [];
      const fallback = response.status === 404 ? 'Ten plan nie istnieje lub został usunięty.' : response.status === 401 || response.status === 403 ? 'Nie masz uprawnień do edycji tego planu na tym urządzeniu.' : 'Nie udało się wykonać działania. Spróbuj ponownie.';
      throw new ApiError(record(data) && typeof data.detail === 'string' ? data.detail : fallback, response.status, errors);
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal?.aborted) throw error;
    throw new ApiError(timedOut ? 'Odpowiedź trwała zbyt długo. Spróbuj ponownie.' : 'Nie udało się połączyć z aplikacją. Sprawdź połączenie i spróbuj ponownie.');
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function expectPlan(body: unknown): Plan { if (!isPlan(body)) throw new ApiError('Aplikacja zwróciła nieprawidłową odpowiedź planu.'); return body; }
export async function getPlaceCatalog(signal?: AbortSignal): Promise<PlaceCatalog> {
  const body = await request('/places', 'GET', undefined, undefined, signal);
  if (!isPlaceCatalog(body)) throw new ApiError('Aplikacja zwróciła nieprawidłowe podpowiedzi miejsc.');
  return body;
}
export async function searchTrips(criteria: Criteria, signal?: AbortSignal): Promise<SearchResult> {
  const body = await request('/searches', 'POST', criteria, undefined, signal, SEARCH_TIMEOUT_MS);
  if (!isSearch(body)) throw new ApiError('Aplikacja zwróciła nieprawidłową odpowiedź wyszukiwania.');
  return body;
}
const isTimestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isAmount = (value: unknown): value is string => typeof value === 'string' && /^\d+(\.\d{1,4})?$/.test(value) && value.length <= 24 && Number.isFinite(Number(value));
const nullableBoolean = (value: unknown) => value === null || typeof value === 'boolean';
const nullableString = (value: unknown) => value === null || typeof value === 'string';
export function isStayCriteria(value: unknown): value is StayCriteria {
  const date = (input: unknown) => typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)
    && Number.isFinite(Date.parse(input)) && new Date(input).toISOString().slice(0, 10) === input;
  return record(value) && typeof value.destination === 'string' && value.destination.length <= 120
    && date(value.checkIn) && date(value.checkOut) && typeof value.adults === 'number' && Number.isInteger(value.adults)
    && value.adults >= 1 && value.adults <= 8 && ['PLN', 'EUR', 'USD', 'GBP'].includes(String(value.currency))
    && (value.rooms === undefined || typeof value.rooms === 'number' && Number.isInteger(value.rooms) && value.rooms >= 1 && value.rooms <= value.adults);
}
export function isStayResult(value: unknown): value is StayResult {
  if (!record(value) || !['OK', 'EMPTY', 'PARTIAL', 'PROVIDER_ERROR', 'RATE_LIMITED', 'UNAVAILABLE'].includes(String(value.status))
    || value.source !== 'OBO Travel' || !isTimestamp(value.checkedAt) || !(value.expiresAt === null || isTimestamp(value.expiresAt))
    || !isStayCriteria(value.criteria)
    || !nullableString(value.message) || !(value.retryAfterSeconds === null || typeof value.retryAfterSeconds === 'number' && Number.isFinite(value.retryAfterSeconds) && value.retryAfterSeconds >= 0)
    || !Array.isArray(value.hotels) || value.hotels.length > 3) return false;
  const currency = value.criteria.currency;
  return value.hotels.every((hotel) => record(hotel) && typeof hotel.hotelToken === 'string' && typeof hotel.name === 'string'
    && (hotel.stars === null || typeof hotel.stars === 'number' && Number.isFinite(hotel.stars) && hotel.stars >= 0 && hotel.stars <= 5)
    && isAmount(hotel.totalPrice) && (hotel.nightlyPrice === null || isAmount(hotel.nightlyPrice)) && hotel.currency === currency
    && typeof hotel.bookingUrl === 'string' && nullableBoolean(hotel.taxesIncluded) && nullableBoolean(hotel.feesIncluded)
    && (hotel.photoUrl === undefined || nullableString(hotel.photoUrl))
    && (hotel.location === undefined || hotel.location === null || record(hotel.location)
      && typeof hotel.location.latitude === 'number' && Number.isFinite(hotel.location.latitude) && Math.abs(hotel.location.latitude) <= 90
      && typeof hotel.location.longitude === 'number' && Number.isFinite(hotel.location.longitude) && Math.abs(hotel.location.longitude) <= 180)
    && nullableString(hotel.inclusionsNote) && isTimestamp(hotel.quotedAt) && isTimestamp(hotel.expiresAt)
    && Date.parse(hotel.expiresAt) > Date.parse(hotel.quotedAt) && Array.isArray(hotel.extraCharges)
    && hotel.extraCharges.every((charge) => record(charge) && typeof charge.name === 'string' && isAmount(charge.amount)
      && typeof charge.currency === 'string' && /^[A-Z]{3}$/.test(charge.currency) && nullableString(charge.payableAt)));
}
export async function searchStays(criteria: StayCriteria, signal?: AbortSignal): Promise<StayResult> {
  const body = await request('/stays/search', 'POST', criteria, undefined, signal, 30000);
  if (!isStayResult(body)) throw new ApiError('Nie udało się odczytać ofert noclegów. Spróbuj ponownie.');
  if (body.criteria.checkIn !== criteria.checkIn || body.criteria.checkOut !== criteria.checkOut || body.criteria.adults !== criteria.adults
    || (body.criteria.rooms ?? 1) !== (criteria.rooms ?? 1)
    || body.criteria.currency !== criteria.currency || body.criteria.destination.trim().toLocaleLowerCase() !== criteria.destination.trim().toLocaleLowerCase()) {
    throw new ApiError('Oferty noclegów nie odpowiadają wybranym parametrom. Wyszukaj ponownie.');
  }
  return body;
}
export async function suggestAttractions(criteria: Criteria, roundTripId: string, interest: Interest, budgetPln: number): Promise<Recommendations> {
  const body = await request('/recommendations', 'POST', { criteria, roundTripId, interest, budgetPln }, undefined, undefined, 12000);
  if (!record(body) || typeof body.aiUsed !== 'boolean' || !Array.isArray(body.suggestions)
      || !body.suggestions.every((item) => record(item) && typeof item.attractionId === 'string' && typeof item.reason === 'string')) {
    throw new ApiError('Nie udało się odczytać propozycji atrakcji.');
  }
  return body as Recommendations;
}
export async function previewPlan(input: PlanInput, signal?: AbortSignal): Promise<Plan> { return expectPlan(await request('/plans/preview', 'POST', input, undefined, signal)); }
export async function createPlan(input: PlanInput): Promise<{ plan: Plan; ownerToken: string }> { const body = await request('/plans', 'POST', input); if (!record(body) || !isPlan(body.plan) || typeof body.ownerToken !== 'string' || !body.ownerToken) throw new ApiError('Aplikacja zwróciła nieprawidłowe potwierdzenie zapisu.'); return { plan: body.plan, ownerToken: body.ownerToken }; }
export async function updatePlan(id: string, input: PlanInput, token: string): Promise<Plan> { return expectPlan(await request(`/plans/${encodeURIComponent(id)}`, 'PUT', input, token)); }
export async function getPlan(id: string, token: string, signal?: AbortSignal): Promise<Plan> { return expectPlan(await request(`/plans/${encodeURIComponent(id)}`, 'GET', undefined, token, signal)); }
export async function getSharedPlan(token: string, signal?: AbortSignal): Promise<Plan> { return expectPlan(await request(`/shared-plans/${encodeURIComponent(token)}`, 'GET', undefined, undefined, signal)); }
export async function deletePlan(id: string, token: string): Promise<void> { await request(`/plans/${encodeURIComponent(id)}`, 'DELETE', undefined, token); }

const ownerTokens = new Map<string, string>();
const ownerKey = (id: string) => `city-break-owner:${id}`;
export function readOwnerToken(id: string): string | null { try { return localStorage.getItem(ownerKey(id)) || ownerTokens.get(id) || null; } catch { return ownerTokens.get(id) || null; } }
export function saveOwnerToken(id: string, token: string): boolean { ownerTokens.set(id, token); try { localStorage.setItem(ownerKey(id), token); return true; } catch { return false; } }
export function clearOwnerToken(id: string): void { ownerTokens.delete(id); try { localStorage.removeItem(ownerKey(id)); } catch { /* Current session access already removed. */ } }
