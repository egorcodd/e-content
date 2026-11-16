import type { Platform } from './model';

export function validateConnectionIdentity(platform: Platform, input: string) {
  const text = input.trim();
  if (platform === 'telegram') {
    const value = text.replace(/[\s()-]/g, '');
    const error = !text
      ? 'Введите номер телефона.'
      : !/^\+[1-9]\d{7,14}$/.test(value)
        ? 'Укажите номер с кодом страны: + и от 8 до 15 цифр.'
        : '';
    return { value, error };
  }
  const name = text.replace(/^@/, '');
  const error = !text
    ? 'Введите имя профиля TikTok.'
    : !/^[a-zA-Z\d_.]{2,24}$/.test(name)
      ? 'Имя профиля: 2–24 латинских буквы, цифры, точки или подчёркивания.'
      : '';
  return { value: `@${name}`, error };
}

export function normalizeConnectionCode(input: string) {
  return input.replace(/\s/g, '');
}

export function validatePreviewCode(input: string) {
  const code = normalizeConnectionCode(input);
  if (!code) return 'Введите код подтверждения.';
  if (!/^\d{6}$/.test(code)) return 'Код должен состоять из 6 цифр.';
  if (code !== '123456') return 'Неверный код. Проверьте и попробуйте ещё раз.';
  return '';
}
