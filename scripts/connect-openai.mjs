import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { LocalStore } from '../server/store.ts';

const apify = process.argv[2] === 'apify';
console.log(`Вставьте API-ключ ${apify ? 'Apify' : 'OpenAI'} и нажмите Enter. Ввод скрыт.`);
if (!process.stdin.isTTY) throw new Error('Откройте файл подключения в локальном терминале.');
const prompt = createInterface({
  input: process.stdin,
  output: new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  }),
  terminal: true,
  historySize: 0,
});
prompt.on('SIGINT', () => process.exit(1));
const key = (await prompt.question('')).trim();
prompt.close();
if (!(apify ? /^apify_api_[\w-]{12,}$/ : /^sk-[\w-]{16,}$/).test(key)) {
  console.error('Ключ не сохранён. Скопируйте секретный ключ целиком.');
  process.exitCode = 1;
} else {
  const store = new LocalStore(resolve(import.meta.dirname, '../.local'), { recoverRuns: false });
  try {
    store.setSecret(apify ? 'apify-api-token' : 'openai-api-key', key);
    console.log('Ключ сохранён в хранилище цеха. Окно можно закрыть.');
  } finally {
    store.close();
  }
}
