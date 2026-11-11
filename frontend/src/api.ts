const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1').replace(/\/+$/, '');

export type Health = { status: 'UP'; database: 'UP' };

export class HealthError extends Error {
  constructor(public readonly kind: 'unavailable' | 'invalid-response') {
    super(kind);
  }
}

export async function fetchHealth(signal: AbortSignal): Promise<Health> {
  const response = await fetch(`${apiBaseUrl}/health`, {
    signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) throw new HealthError('unavailable');

  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('status' in body) ||
      !('database' in body) || body.status !== 'UP' || body.database !== 'UP') {
    throw new HealthError('invalid-response');
  }

  return { status: 'UP', database: 'UP' };
}
