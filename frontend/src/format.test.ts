import { describe, expect, it } from 'vitest';
import { fromZonedInput, zonedInput } from './format';

describe('lokalna godzina atrakcji', () => {
  it('zachowuje godzinę Londynu po edycji i ponownym odczycie', () => {
    const local = '2099-07-10T15:20';
    const utc = fromZonedInput(local, 'Europe/London');
    expect(utc).toBe('2099-07-10T14:20:00.000Z');
    expect(zonedInput(utc!, 'Europe/London')).toBe(local);
    expect(zonedInput(utc!, 'Europe/Paris')).toBe('2099-07-10T16:20');
  });

  it('odrzuca nieistniejącą godzinę w dniu zmiany czasu', () => {
    expect(fromZonedInput('2026-03-29T01:30', 'Europe/London')).toBeNull();
    expect(fromZonedInput('2026-03-29T03:30', 'Europe/London')).toBe('2026-03-29T02:30:00.000Z');
  });
});
