import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOW_KEY, readPlannerFlow, travelContext, writePlannerFlow } from './plannerFlow';
import type { PlannerFlow } from './plannerFlow';
import { criteria } from './test/fixtures';

const flow: PlannerFlow = { step: 'stay', furthest: 'summary', chosenHotelToken: 'chosen-hotel', staySkipped: false, attractionTab: 'schedule' };
const context = travelContext(criteria);
beforeEach(() => sessionStorage.clear());
afterEach(() => { sessionStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('przywracanie etapów planera', () => {
  it('przywraca etap i wybór tylko dla właściwego planu, trasy i dat', () => {
    writePlannerFlow('draft', context, flow);
    expect(readPlannerFlow('draft', context)).toEqual({ ...flow, context });
    expect(readPlannerFlow('owner:other', context)).toBeNull();
    expect(readPlannerFlow('draft', travelContext({ ...criteria, destination: 'Amsterdam' }))).toBeNull();
    expect(readPlannerFlow('draft', travelContext({ ...criteria, travelers: 3 }))).toBeNull();
    expect(readPlannerFlow('draft', travelContext({ ...criteria, returnDate: '2099-12-20' }))).toBeNull();
  });

  it('odrzuca wygasłe dane oraz kroki wykraczające poza osiągnięty etap', () => {
    vi.useFakeTimers();
    writePlannerFlow('draft', context, flow);
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(readPlannerFlow('draft', context)).toBeNull();
    expect(sessionStorage.getItem(FLOW_KEY)).toBeNull();
    writePlannerFlow('draft', context, { ...flow, step: 'summary', furthest: 'connection' });
    expect(readPlannerFlow('draft', context)).toBeNull();
    sessionStorage.setItem(FLOW_KEY, '{broken');
    expect(readPlannerFlow('draft', context)).toBeNull();
  });

  it('działa przy zablokowanym magazynie przeglądarki', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(() => writePlannerFlow('draft', context, flow)).not.toThrow();
    expect(readPlannerFlow('draft', context)).toBeNull();
  });
});
