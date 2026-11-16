import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto((process.env.PREVIEW_URL || 'http://127.0.0.1:5186') + '/sources');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  const range = (name) => page.getByRole('slider', { name, exact: true });
  const color = async (name) => {
    await page.waitForTimeout(190);
    return range(name).evaluate((input) => {
      const output = input.closest('.source-range').querySelector('output');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      context.fillStyle = getComputedStyle(output).color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    });
  };
  const neutral = (channels) => channels.every((channel) => channel === channels[0]);
  for (const name of ['Публикации', 'Комментарии']) {
    const channels = await color(name);
    assert.ok(
      neutral(channels),
      `${name}: ordinary default volume must be neutral, got ${channels}`,
    );
  }
  const publications = range('Публикации');
  await publications.focus();
  await page.keyboard.press('End');
  const full = await color('Публикации');
  assert.ok(full[0] > full[1] + 30, 'Exhausting the configured budget should warn');
  await page
    .getByRole('region', { name: 'Общие настройки', exact: true })
    .getByRole('button', { name: 'Общие настройки', exact: true })
    .click();
  await page.getByRole('button', { name: 'Общий объём сбора', exact: true }).click();
  await range('Всего публикаций').focus();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Сохранить параметры', exact: true }).click();
  assert.equal(await publications.inputValue(), '500');
  assert.ok(
    neutral(await color('Публикации')),
    'A larger budget must clear the warning without changing source volume',
  );
  console.log(
    'Range colors passed: ordinary defaults neutral, exhausted budget warns, changing budget updates color without changing source volume.',
  );
} finally {
  await browser.close();
}
