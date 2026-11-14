import type { Criteria, Plan, SearchResult } from './types';

export const PLANNER_DRAFT_KEY = 'city-break-planner-draft:v1';
const MAX_AGE = 30 * 60 * 1000;
const MAX_BYTES = 512 * 1024;
export type PlannerDraft = { criteria: Criteria; plan: Plan; result: SearchResult };

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 4096;
const optionalText = (v: unknown) => v == null || text(v);
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const array = (v: unknown, valid: (item: unknown) => boolean, max = 200) => Array.isArray(v) && v.length <= max && v.every(valid);
const timestamp = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const optionalTimestamp = (v: unknown) => v == null || timestamp(v);
const date = (v: unknown) => text(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && timestamp(v);
const fare = (v: unknown) => v === 'STANDARD' || v === 'REDUCED';
function criteria(v: unknown): v is Criteria {
  return record(v) && text(v.origin) && text(v.destination) && date(v.departureDate) && date(v.returnDate)
    && ['LOWEST_TOTAL_COST', 'SHORTEST_TRAVEL_TIME', 'FEWEST_TRANSFERS', 'MOST_TIME_AT_DESTINATION'].includes(String(v.priority))
    && text(v.currency) && /^[A-Z]{3}$/.test(v.currency) && fare(v.fareType)
    && (v.travelers === undefined || typeof v.travelers === 'number' && Number.isInteger(v.travelers) && v.travelers >= 1 && v.travelers <= 8);
}
function place(v: unknown): boolean {
  if (!record(v) || !text(v.name)) return false;
  if (!(v.latitude === null || typeof v.latitude === 'number' && Number.isFinite(v.latitude) && Math.abs(v.latitude) <= 90)
    || !(v.longitude === null || typeof v.longitude === 'number' && Number.isFinite(v.longitude) && Math.abs(v.longitude) <= 180)) return false;
  if (v.timeZone !== undefined) {
    if (!text(v.timeZone)) return false;
    try { new Intl.DateTimeFormat('pl-PL', { timeZone: v.timeZone }); } catch { return false; }
  }
  return true;
}
function cost(v: unknown): boolean {
  return record(v) && optionalText(v.total) && text(v.currency) && /^[A-Z]{3}$/.test(v.currency)
    && typeof v.complete === 'boolean' && fare(v.fareType) && array(v.missingComponents, text);
}
function price(v: unknown): boolean {
  return record(v) && ['KNOWN', 'UNKNOWN', 'PROVIDER_ERROR'].includes(String(v.status)) && optionalText(v.amount)
    && text(v.currency) && /^[A-Z]{3}$/.test(v.currency) && fare(v.fareType) && optionalText(v.eligibility)
    && text(v.sourceId) && optionalText(v.sourceUrl) && optionalTimestamp(v.checkedAt) && optionalText(v.reason);
}
function source(v: unknown): boolean {
  return record(v) && text(v.sourceId) && text(v.status) && optionalText(v.url)
    && optionalTimestamp(v.checkedAt) && optionalText(v.message);
}
function journey(v: unknown): boolean {
  return record(v) && timestamp(v.departureAt) && timestamp(v.arrivalAt)
    && Array.isArray(v.segments) && v.segments.length > 0 && array(v.segments, (segment) => record(segment)
      && text(segment.id) && text(segment.mode) && text(segment.operator) && place(segment.origin) && place(segment.destination)
      && timestamp(segment.departureAt) && timestamp(segment.arrivalAt) && array(segment.prices, price)
      && optionalText(segment.bookingUrl) && optionalText(segment.mapUrl) && optionalText(segment.scheduleSourceUrl)
      && optionalTimestamp(segment.schedulePublishedAt) && optionalTimestamp(segment.scheduleCheckedAt), 100);
}
function trip(v: unknown): boolean {
  return record(v) && text(v.id) && journey(v.outbound) && journey(v.returnJourney)
    && number(v.travelMinutes) && number(v.transfers) && number(v.timeAtDestinationMinutes)
    && cost(v.costSummary) && array(v.recommendedAttractionIds, text);
}
function attraction(v: unknown): boolean {
  return record(v) && text(v.id) && text(v.name) && place(v.location) && number(v.visitMinutes)
    && array(v.entryPrices, price) && array(v.sources, source) && record(v.openingHours)
    && ['KNOWN', 'UNKNOWN'].includes(String(v.openingHours.status))
    && array(v.openingHours.intervals, (interval) => record(interval) && timestamp(interval.opensAt) && timestamp(interval.closesAt));
}
function plan(v: unknown): v is Plan {
  return record(v) && v.id === null && criteria(v.criteria) && trip(v.selectedRoundTrip) && cost(v.costSummary)
    && typeof v.testData === 'boolean' && optionalTimestamp(v.createdAt) && optionalTimestamp(v.updatedAt)
    && v.shareUrl == null && (v.lodging == null || place(v.lodging)) && array(v.items, (item) => record(item) && text(item.id) && text(item.attractionId) && text(item.name)
      && timestamp(item.startsAt) && timestamp(item.endsAt) && (item.transferMinutesFromPrevious === null || number(item.transferMinutesFromPrevious))
      && (item.transferBasis == null || item.transferBasis === 'ESTIMATED_WALKING') && optionalText(item.transferFrom)
      && (item.automaticTime === undefined || typeof item.automaticTime === 'boolean') && (item.location == null || place(item.location))
      && array(item.conflicts, (conflict) => record(conflict) && text(conflict.code) && text(conflict.reason) && text(conflict.itemId)));
}
function result(v: unknown): v is SearchResult {
  return record(v) && text(v.searchId) && criteria(v.criteria) && typeof v.testData === 'boolean'
    && ['OK', 'PARTIAL', 'NO_CONNECTION', 'PROVIDER_ERROR'].includes(String(v.status))
    && array(v.roundTripOptions, trip, 24) && array(v.attractions, attraction) && array(v.sources, source);
}
export function clearPlannerDraft(): void {
  try { sessionStorage.removeItem(PLANNER_DRAFT_KEY); } catch { /* Browser storage is optional. */ }
}
export function readPlannerDraft(): PlannerDraft | null {
  try {
    const raw = sessionStorage.getItem(PLANNER_DRAFT_KEY);
    if (raw === null) return null;
    if (raw.length > MAX_BYTES || new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error('Draft too large');
    const data: unknown = JSON.parse(raw);
    if (!record(data) || data.version !== 1 || typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt)
      || data.expiresAt <= Date.now() || data.expiresAt > Date.now() + MAX_AGE
      || !criteria(data.criteria) || !plan(data.plan) || !result(data.result)) throw new Error('Invalid draft');
    return { criteria: data.criteria, plan: data.plan, result: data.result };
  } catch { clearPlannerDraft(); return null; }
}
export function writePlannerDraft(draft: PlannerDraft): void {
  try {
    // Owner/share capabilities and hotel quotes have their own lifecycle.
    const snapshot = { ...draft, plan: { ...draft.plan, id: null, shareUrl: null }, version: 1, expiresAt: Date.now() + MAX_AGE };
    const raw = JSON.stringify(snapshot);
    if (raw.length > MAX_BYTES || new TextEncoder().encode(raw).byteLength > MAX_BYTES) { clearPlannerDraft(); return; }
    sessionStorage.setItem(PLANNER_DRAFT_KEY, raw);
  } catch { clearPlannerDraft(); }
}
