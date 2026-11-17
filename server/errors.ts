export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAt?: string,
  ) {
    super(message);
  }
}
export function telegramError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const item = (error ?? {}) as {
    errorMessage?: string;
    message?: string;
    seconds?: number;
    name?: string;
  };
  const code = item.errorMessage ?? item.message ?? '';
  const wait = item.seconds ?? Number(/FLOOD_(?:PREMIUM_)?WAIT_(\d+)/.exec(code)?.[1]);
  if (Number.isFinite(wait) && wait > 0)
    return new AppError(
      429,
      'FLOOD_WAIT',
      `Telegram просит подождать ${wait} сек.`,
      new Date(Date.now() + wait * 1000).toISOString(),
    );
  const messages: Record<string, string> = {
    PHONE_NUMBER_INVALID: 'Telegram не принял номер телефона.',
    PHONE_CODE_INVALID: 'Неверный код подтверждения.',
    PHONE_CODE_EMPTY: 'Введите код подтверждения.',
    PHONE_CODE_EXPIRED: 'Код истёк. Запросите новый код.',
    PASSWORD_HASH_INVALID: 'Неверный пароль двухэтапной защиты.',
    API_ID_INVALID: 'Проверьте api_id и api_hash приложения.',
    PHONE_NUMBER_BANNED: 'Telegram ограничил этот номер.',
    CHANNEL_PRIVATE: 'Нет доступа к каналу или группе обсуждения.',
    CHANNEL_INVALID: 'Канал недоступен.',
    USERNAME_INVALID: 'Проверьте имя канала.',
    USERNAME_NOT_OCCUPIED: 'Канал с таким именем не найден.',
    SESSION_REVOKED: 'Сессия Telegram отозвана. Подключите аккаунт заново.',
    AUTH_KEY_UNREGISTERED: 'Нужно снова войти в Telegram.',
    MSG_ID_INVALID: 'Публикация или обсуждение недоступны.',
    CHAT_ADMIN_REQUIRED: 'Для этих данных нужны права администратора.',
  };
  return new AppError(
    400,
    messages[code] ? code : 'TELEGRAM_ERROR',
    messages[code] ?? 'Не удалось выполнить запрос к Telegram. Проверьте соединение и повторите.',
  );
}
