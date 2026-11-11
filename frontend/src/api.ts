import type { Criteria, Plan, PlanInput, SearchResult } from './types';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1').replace(/\/+$/, '');
export const REQUEST_TIMEOUT_MS = 10000;
export class ApiError extends Error {
  constructor(message: string, public readonly status = 0, public readonly errors: { field: string; message: string }[] = []) { super(message); }
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function isPlan(body: unknown): body is Plan { return record(body) && record(body.criteria) && record(body.selectedRoundTrip) && record(body.costSummary) && Array.isArray(body.items); }
function isSearch(body: unknown): body is SearchResult { return record(body) && record(body.criteria) && ['OK', 'PARTIAL', 'NO_CONNECTION', 'PROVIDER_ERROR'].includes(String(body.status)) && Array.isArray(body.roundTripOptions) && Array.isArray(body.attractions) && Array.isArray(body.sources); }

async function request(path: string, method: string, body?: unknown, token?: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
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
export async function searchTrips(criteria: Criteria, signal?: AbortSignal): Promise<SearchResult> { const body = await request('/searches', 'POST', criteria, undefined, signal); if (!isSearch(body)) throw new ApiError('Aplikacja zwróciła nieprawidłową odpowiedź wyszukiwania.'); return body; }
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
