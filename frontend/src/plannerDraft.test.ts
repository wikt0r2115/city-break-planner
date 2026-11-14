import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPlannerDraft, PLANNER_DRAFT_KEY, readPlannerDraft, writePlannerDraft } from './plannerDraft';
import { criteria, planFor, result } from './test/fixtures';

beforeEach(() => sessionStorage.clear());
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });
const save = () => writePlannerDraft({ criteria, plan: planFor(), result });

describe('roboczy plan w bieżącej karcie', () => {
  it('przywraca pełny edytor bez uprawnień właściciela ani publicznego linku', () => {
    writePlannerDraft({ criteria, result, plan: { ...planFor(), id: 'saved-owner-plan', shareUrl: 'https://example.com/shared/private-capability' } });
    expect(readPlannerDraft()).toMatchObject({ criteria, result, plan: { id: null, shareUrl: null, items: JSON.parse(JSON.stringify(planFor().items)) } });
    expect(sessionStorage.getItem(PLANNER_DRAFT_KEY)).not.toContain('private-capability');
    expect(sessionStorage.getItem(PLANNER_DRAFT_KEY)).not.toContain('saved-owner-plan');
  });

  it('usuwa wygasły plan i nie pozwala przedłużyć TTL uszkodzonym timestampem', () => {
    vi.useFakeTimers();
    save();
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(readPlannerDraft()).toBeNull();
    expect(sessionStorage.getItem(PLANNER_DRAFT_KEY)).toBeNull();
    save();
    const raw = JSON.parse(sessionStorage.getItem(PLANNER_DRAFT_KEY)!);
    raw.expiresAt = Date.now() + 31 * 60 * 1000;
    sessionStorage.setItem(PLANNER_DRAFT_KEY, JSON.stringify(raw));
    expect(readPlannerDraft()).toBeNull();
  });

  it('odrzuca niepoprawne zagnieżdżenia zamiast uszkadzać mapę lub harmonogram', () => {
    for (const mutate of [
      (raw: any) => { raw.plan.selectedRoundTrip = {}; },
      (raw: any) => { raw.criteria.travelers = 1.5; },
      (raw: any) => { raw.plan.criteria.travelers = 0; },
      (raw: any) => { raw.plan.selectedRoundTrip.outbound.segments = null; },
      (raw: any) => { raw.plan.selectedRoundTrip.outbound.segments[0].destination.timeZone = 'Not/A_Zone'; },
      (raw: any) => { raw.plan.items[0].conflicts = [{}]; },
      (raw: any) => { raw.result.attractions[0].entryPrices = [null]; },
      (raw: any) => { raw.result.roundTripOptions = [{}]; },
    ]) {
      save();
      const raw = JSON.parse(sessionStorage.getItem(PLANNER_DRAFT_KEY)!);
      mutate(raw);
      sessionStorage.setItem(PLANNER_DRAFT_KEY, JSON.stringify(raw));
      expect(readPlannerDraft()).toBeNull();
      expect(sessionStorage.getItem(PLANNER_DRAFT_KEY)).toBeNull();
    }
  });

  it('toleruje błędny JSON, zbyt duży zapis i niedostępny sessionStorage', () => {
    for (const raw of ['{', 'x'.repeat(512 * 1024 + 1)]) {
      sessionStorage.setItem(PLANNER_DRAFT_KEY, raw);
      expect(readPlannerDraft()).toBeNull();
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Private mode'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    expect(() => save()).not.toThrow();
    expect(readPlannerDraft()).toBeNull();
    expect(() => clearPlannerDraft()).not.toThrow();
  });
});
