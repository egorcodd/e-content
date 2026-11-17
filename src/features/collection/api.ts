import { readConnections, type ConnectionState } from '../sources/connections';
import { updateManagedSources } from '../sources/repository';

let csrf: string | undefined;
let sessionPromise: Promise<ConnectionState> | undefined;
export class LocalApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryAt?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  retrySession = true,
): Promise<T> {
  if (!csrf) await refreshLocalSession();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf! } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new LocalApiError(
      'Не удалось связаться с локальным сервером. Проверьте, что проект запущен через start.cmd.',
      'UNAVAILABLE',
    );
  }
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new LocalApiError(
      'Локальный сервер API недоступен. Перезапустите проект через start.cmd.',
      'UNAVAILABLE',
    );
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 403 && ['CSRF', 'SESSION'].includes(result.error?.code)) {
      csrf = undefined;
      if (retrySession) {
        await refreshLocalSession();
        return api<T>(path, method, body, false);
      }
    }
    throw new LocalApiError(
      result.error?.message ?? 'Не удалось выполнить действие.',
      result.error?.code ?? 'REQUEST_FAILED',
      result.error?.retryAt,
    );
  }
  return result;
}
export async function refreshLocalSession() {
  return (sessionPromise ??= readConnections()
    .then((result) => {
      csrf = result.csrfToken;
      updateManagedSources(result.managedSources ?? []);
      return result;
    })
    .finally(() => {
      sessionPromise = undefined;
    }));
}
