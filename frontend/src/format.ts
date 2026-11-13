import type { Plan, ItemInput } from './types';
export function dateInWarsaw(date = new Date()): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
export function nextDate(days: number): string {
  const [year, month, day] = dateInWarsaw().split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
export function moment(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Nieznany czas' : new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date); }
export function duration(minutes: number): string { const hours = Math.floor(minutes / 60); const remainder = minutes % 60; return `${hours ? `${hours} h` : ''}${hours && remainder ? ' ' : ''}${remainder || !hours ? `${remainder} min` : ''}`; }
export function money(amount: string, currency: string): string { const number = Number(amount); if (!Number.isFinite(number)) return 'Cena niepotwierdzona'; try { return new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(number); } catch { return `${amount} ${currency}`; } }
export function safeUrl(value: string | null | undefined): string | undefined { if (!value) return undefined; try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }
export function itemsFromPlan(plan: Plan): ItemInput[] {
  return plan.items.map((item) => ({
    id: item.id,
    attractionId: item.attractionId,
    startsAt: item.startsAt,
    visitMinutes: Math.max(1, Math.round((new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60000)),
    automaticTime: item.automaticTime ?? false,
  }));
}
export function warsawInput(value: string): string { const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)); return parts.replace(' ', 'T'); }
export function fromWarsawInput(value: string): string | null { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null; const utc = Date.parse(`${value}:00Z`); let target = utc; for (let i = 0; i < 3; i++) { const displayed = warsawInput(new Date(target).toISOString()); target += utc - Date.parse(`${displayed}:00Z`); } return warsawInput(new Date(target).toISOString()) === value ? new Date(target).toISOString() : null; }
