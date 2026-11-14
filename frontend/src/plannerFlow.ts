import type { Criteria } from './types';

export const FLOW_KEY = 'city-break-flow:v1';
export const FLOW_STEPS = ['direction', 'connection', 'stay', 'attractions', 'summary'] as const;
export type FlowStep = typeof FLOW_STEPS[number];
export type PlannerFlow = {
  step: FlowStep; furthest: FlowStep; chosenHotelToken: string | null; staySkipped: boolean;
  attractionTab: 'catalog' | 'schedule';
};
const MAX_AGE = 30 * 60 * 1000;
export const travelContext = (criteria: Criteria) => JSON.stringify([criteria.origin, criteria.destination, criteria.departureDate, criteria.returnDate, criteria.travelers ?? 1]);
export function clearPlannerFlow() { try { sessionStorage.removeItem(FLOW_KEY); } catch { /* Optional storage. */ } }
export function readPlannerFlow(scope: string, context?: string): (PlannerFlow & { context: string }) | null {
  try {
    const raw = sessionStorage.getItem(FLOW_KEY);
    if (!raw) return null;
    if (raw.length > 4096) { clearPlannerFlow(); return null; }
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || typeof data.scope !== 'string' || typeof data.context !== 'string' || data.context.length > 1000
      || !FLOW_STEPS.includes(data.step) || !FLOW_STEPS.includes(data.furthest)
      || FLOW_STEPS.indexOf(data.step) > FLOW_STEPS.indexOf(data.furthest)
      || !(data.chosenHotelToken === null || typeof data.chosenHotelToken === 'string' && data.chosenHotelToken.length <= 2048)
      || typeof data.staySkipped !== 'boolean' || !['catalog', 'schedule'].includes(data.attractionTab)
      || typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()
      || data.expiresAt > Date.now() + MAX_AGE) { clearPlannerFlow(); return null; }
    if (data.scope !== scope || context !== undefined && data.context !== context) return null;
    return { step: data.step, furthest: data.furthest, chosenHotelToken: data.chosenHotelToken,
      staySkipped: data.staySkipped, attractionTab: data.attractionTab, context: data.context };
  } catch { clearPlannerFlow(); return null; }
}
export function writePlannerFlow(scope: string, context: string, flow: PlannerFlow) {
  try { sessionStorage.setItem(FLOW_KEY, JSON.stringify({ ...flow, scope, context, version: 1, expiresAt: Date.now() + MAX_AGE })); }
  catch { /* Optional storage. */ }
}
