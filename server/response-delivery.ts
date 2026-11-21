import { setTimeout as wait } from 'node:timers/promises';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from './errors.ts';

const endpoint = 'https://api.openai.com/v1/responses';
const preConnect = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
]);
const networkCode = (err: unknown) =>
  String((err as { cause?: { code?: string } })?.cause?.code ?? 'NETWORK');
const uncertain = () =>
  new AppError(
    409,
    'AI_UNCONFIRMED',
    'Связь прервалась до получения номера задания OpenAI. Отправка не подтверждена, выборка сохранена.',
  );

export class ResponseDelivery {
  constructor(
    private db: DatabaseSync,
    private request: typeof fetch,
    private pause = (ms: number) => wait(ms),
  ) {}

  async receive(fingerprint: string, key: string, payload: object, signal?: AbortSignal) {
    const row = this.db.prepare('SELECT * FROM ai_deliveries WHERE fingerprint=?').get(fingerprint);
    if (!row || row.state === 'creating') throw uncertain();
    if (row.result) return JSON.parse(String(row.result));
    let remote = row.remote_id ? String(row.remote_id) : '';
    const deadline = Date.now() + 300_000;
    let failures = 0;
    for (;;) {
      signal?.throwIfAborted();
      if (Date.now() >= deadline)
        throw new AppError(
          503,
          'AI_PENDING',
          'Задание OpenAI ещё выполняется. Его номер сохранён.',
        );
      const creating = !remote;
      if (
        creating &&
        !this.db
          .prepare(
            "UPDATE ai_deliveries SET state='creating' WHERE fingerprint=? AND state='ready'",
          )
          .run(fingerprint).changes
      )
        throw uncertain();
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(creating ? 60_000 : 20_000);
        response = await this.request(
          creating ? endpoint : endpoint + '/' + encodeURIComponent(remote),
          {
            method: creating ? 'POST' : 'GET',
            headers: {
              Authorization: 'Bearer ' + key,
              'Content-Type': 'application/json',
              'X-Client-Request-Id': fingerprint,
            },
            ...(creating && {
              body: JSON.stringify({ ...payload, background: true, store: false }),
            }),
            redirect: 'error',
            signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
          },
        );
      } catch (err) {
        const code = networkCode(err);
        const safe = !creating || preConnect.has(code);
        this.db
          .prepare('UPDATE ai_deliveries SET diagnostic=?,state=? WHERE fingerprint=?')
          .run(code, creating ? (safe ? 'ready' : 'creating') : 'accepted', fingerprint);
        signal?.throwIfAborted();
        if (!safe) throw uncertain();
        if (++failures >= 4)
          throw new AppError(
            503,
            'AI_OFFLINE',
            'Нет соединения с OpenAI. Данные для продолжения сохранены.',
          );
        await this.pause(1000 * failures);
        continue;
      }

      if (!response.ok) {
        const status = response.status;
        this.db
          .prepare('UPDATE ai_deliveries SET diagnostic=? WHERE fingerprint=?')
          .run('HTTP ' + status, fingerprint);
        if (creating && status === 429) {
          const info = await response.json().catch(() => null);
          const retrySeconds = Number(response.headers.get('retry-after'));
          const retryMs = Math.max(
            1000 * ++failures,
            Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0,
          );
          if (
            info?.error?.code !== 'insufficient_quota' &&
            failures < 3 &&
            Date.now() + retryMs < deadline
          ) {
            this.db
              .prepare("UPDATE ai_deliveries SET state='ready' WHERE fingerprint=?")
              .run(fingerprint);
            await this.pause(retryMs);
            continue;
          }
        }
        if (creating && [400, 401, 403, 429].includes(status)) {
          const message: Record<number, string> = {
            400: 'OpenAI отклонил параметры запроса.',
            401: 'OpenAI отклонил ключ.',
            403: 'OpenAI запретил доступ к модели.',
            429: 'OpenAI ограничил запрос. Проверьте кредиты и лимиты.',
          };
          throw new AppError(502, 'AI_REQUEST_REJECTED', message[status]);
        }
        if (!creating && (status === 429 || status >= 500) && ++failures < 6) {
          const seconds = Number(response.headers.get('retry-after')) || 0;
          if (seconds * 1000 > deadline - Date.now())
            throw new AppError(
              503,
              'AI_PENDING',
              'OpenAI отложил чтение результата. Номер задания сохранён.',
            );
          await this.pause(Math.max(1000 * failures, seconds * 1000));
          continue;
        }
        throw new AppError(
          502,
          'AI_PROVIDER',
          creating
            ? 'OpenAI не подтвердил создание задания.'
            : 'Не удалось прочитать сохранённое задание OpenAI (HTTP ' + status + ').',
        );
      }
      let data;
      try {
        data = await response.json();
      } catch {
        if (creating) throw uncertain();
        if (++failures < 5) {
          await this.pause(1000 * failures);
          continue;
        }
        throw new AppError(
          502,
          'AI_PENDING',
          'Связь прервалась при чтении результата. Номер задания сохранён.',
        );
      }
      if (data.status === 'queued' || data.status === 'in_progress') {
        if (typeof data.id !== 'string' || !data.id || (remote && data.id !== remote))
          throw new AppError(502, 'AI_RESPONSE', 'OpenAI вернул некорректный номер задания.');
        remote = data.id;
        this.db
          .prepare(
            "UPDATE ai_deliveries SET state='accepted',remote_id=?,diagnostic=NULL WHERE fingerprint=?",
          )
          .run(remote, fingerprint);
        failures = 0;
        await this.pause(1500);
        continue;
      }
      this.db
        .prepare(
          "UPDATE ai_deliveries SET state='received',result=?,remote_id=?,diagnostic=NULL WHERE fingerprint=?",
        )
        .run(JSON.stringify(data), remote || data.id || null, fingerprint);
      return data;
    }
  }
}
