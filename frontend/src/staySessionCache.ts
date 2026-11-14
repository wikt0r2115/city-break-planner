import { isStayCriteria, isStayResult } from './api';
import type { StayCriteria, StayResult } from './types';

export const STAY_SESSION_KEY = 'city-break-stays:v1';
export const STAY_CACHE_MAX_BYTES = 100 * 1024;
const MAX_ENTRIES = 3;
const QUOTE_LIFETIME = 30 * 60 * 1000;
const originalDeadlines = new WeakMap<StayResult, number>();
type Entry = { context: string; criteria: StayCriteria; result: StayResult; savedAt: number };
type Form = { context: string; criteria: StayCriteria };
type Envelope = { version: 1; entries: Entry[]; forms: Form[] };
const empty = (): Envelope => ({ version: 1, entries: [], forms: [] });
const byteSize = (value: string) => Math.max(value.length * 2, new TextEncoder().encode(value).byteLength);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const key = (context: string, criteria: StayCriteria) => JSON.stringify([context, criteria.destination.trim().toLocaleLowerCase(), criteria.checkIn, criteria.checkOut, criteria.adults, criteria.currency, criteria.rooms ?? 1]);
const sameCriteria = (left: StayCriteria, right: StayCriteria) => key('', left) === key('', right);

/** Uses timestamps from the original quote, never a sliding TTL from the last read. */
export function stayExpiry(result: StayResult, savedAt = Number.POSITIVE_INFINITY): number | null {
  const deadlines: number[] = [];
  const remembered = originalDeadlines.get(result);
  if (remembered !== undefined) deadlines.push(remembered);
  if (Number.isFinite(savedAt)) deadlines.push(savedAt + QUOTE_LIFETIME);
  if (result.expiresAt) deadlines.push(Date.parse(result.expiresAt));
  if (result.hotels.length) deadlines.push(Date.parse(result.checkedAt) + QUOTE_LIFETIME);
  for (const hotel of result.hotels) deadlines.push(Date.parse(hotel.expiresAt), Date.parse(hotel.quotedAt) + QUOTE_LIFETIME);
  return deadlines.length ? Math.min(...deadlines) : null;
}

function forgetStorage() { try { sessionStorage.removeItem(STAY_SESSION_KEY); } catch { /* Storage can be blocked by browser settings. */ } }
function persist(cache: Envelope) {
  try {
    let serialized = JSON.stringify(cache);
    while (byteSize(serialized) > STAY_CACHE_MAX_BYTES && cache.entries.length) { cache.entries.pop(); serialized = JSON.stringify(cache); }
    if (byteSize(serialized) > STAY_CACHE_MAX_BYTES) { forgetStorage(); return; }
    sessionStorage.setItem(STAY_SESSION_KEY, serialized);
  } catch { /* The current component still keeps its fresh results in memory. */ }
}

function load(): { cache: Envelope; expiredKeys: string[] } {
  try {
    const raw = sessionStorage.getItem(STAY_SESSION_KEY);
    if (!raw) return { cache: empty(), expiredKeys: [] };
    if (byteSize(raw) > STAY_CACHE_MAX_BYTES) { forgetStorage(); return { cache: empty(), expiredKeys: [] }; }
    const parsed: unknown = JSON.parse(raw);
    if (!object(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > MAX_ENTRIES
      || !Array.isArray(parsed.forms) || parsed.forms.length > MAX_ENTRIES) { forgetStorage(); return { cache: empty(), expiredKeys: [] }; }
    const expiredKeys: string[] = [];
    const entries: Entry[] = [];
    for (const entry of parsed.entries) {
      if (!object(entry) || typeof entry.context !== 'string' || entry.context.length > 1000 || !isStayCriteria(entry.criteria)
        || !isStayResult(entry.result) || !sameCriteria(entry.criteria, entry.result.criteria)
        || !['OK', 'PARTIAL'].includes(entry.result.status) || !entry.result.hotels.length
        || typeof entry.savedAt !== 'number' || !Number.isFinite(entry.savedAt) || entry.savedAt > Date.now() || entry.savedAt < 0) continue;
      const expiry = stayExpiry(entry.result, entry.savedAt);
      if (expiry === null || !Number.isFinite(expiry) || expiry <= Date.now()) { expiredKeys.push(key(entry.context, entry.criteria)); continue; }
      originalDeadlines.set(entry.result, expiry);
      entries.push(entry as Entry);
    }
    const forms = parsed.forms.filter((form): form is Form => object(form) && typeof form.context === 'string' && form.context.length <= 1000 && isStayCriteria(form.criteria));
    const cache: Envelope = { version: 1, entries, forms };
    persist(cache);
    return { cache, expiredKeys };
  } catch { forgetStorage(); return { cache: empty(), expiredKeys: [] }; }
}

export function readStaySession(context: string, fallback: StayCriteria) {
  const { cache, expiredKeys } = load();
  const criteria = cache.forms.find((form) => form.context === context)?.criteria ?? fallback;
  const found = cache.entries.find((entry) => key(entry.context, entry.criteria) === key(context, criteria));
  return { criteria, result: found?.result ?? null, expired: expiredKeys.includes(key(context, criteria)) };
}
export function readCachedStay(context: string, criteria: StayCriteria): StayResult | null {
  return load().cache.entries.find((entry) => key(entry.context, entry.criteria) === key(context, criteria))?.result ?? null;
}
export function rememberStayForm(context: string, criteria: StayCriteria) {
  if (!isStayCriteria(criteria)) return;
  const { cache } = load();
  cache.forms = [{ context, criteria }, ...cache.forms.filter((form) => form.context !== context)].slice(0, MAX_ENTRIES);
  persist(cache);
}
export function rememberStayResult(context: string, result: StayResult) {
  if (!isStayResult(result) || !isStayCriteria(result.criteria) || !['OK', 'PARTIAL'].includes(result.status) || !result.hotels.length) return;
  const savedAt = Date.now();
  const expiry = stayExpiry(result, savedAt);
  if (expiry === null || !Number.isFinite(expiry) || expiry <= savedAt) return;
  originalDeadlines.set(result, expiry);
  const { cache } = load();
  cache.entries = [{ context, criteria: result.criteria, result, savedAt }, ...cache.entries.filter((entry) => key(entry.context, entry.criteria) !== key(context, result.criteria))].slice(0, MAX_ENTRIES);
  cache.forms = [{ context, criteria: result.criteria }, ...cache.forms.filter((form) => form.context !== context)].slice(0, MAX_ENTRIES);
  persist(cache);
}
export function removeCachedStay(context: string, criteria: StayCriteria) {
  const { cache } = load();
  cache.entries = cache.entries.filter((entry) => key(entry.context, entry.criteria) !== key(context, criteria));
  persist(cache);
}
export function purgeStaySession() { load(); }
