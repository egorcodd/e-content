import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogVideo, TikTokMeasurement } from '../../src/features/analytics/contracts.ts';
import { catalogChange } from '../../src/features/analytics/counters.ts';
import { accountWindow, periodGrowth } from '../../src/features/analytics/model.ts';

const video = (id: string, views?: number, date = '2025-01-01'): CatalogVideo => ({
  id, date, url: '', title: '', counters: { views },
});

test('old videos contribute their observed change, new publications contribute their first count', () => {
  const before = [video('old', 1000), video('hidden', 900)];
  const after = [video('old', 1020), video('new', 40, '2026-11-19'), video('rediscovered', 700)];
  const change = catalogChange(before, after, '2026-11-18T12:00:00Z');
  assert.deepEqual(change, { coverageChanged: true, counters: { views: 60 } });
  assert.equal(catalogChange(before, [], '2026-11-18').counters.views, undefined);
  assert.equal(catalogChange(before, [video('old')], '2026-11-18').counters.views, undefined);
  assert.equal(catalogChange(before, before, '2026-11-18').counters.views, 0);
});

test('windows include the boundary, exclude crossing intervals and do not fabricate an initial gain', () => {
  const make = (day: number, views: number, step: number): TikTokMeasurement => ({
    date: new Date(Date.UTC(2026, 10, day, 12)).toISOString(), id: String(day), videos: 2,
    counters: { views }, followers: day + 100, change: { counters: { views: step }, coverageChanged: false },
  });
  const history = [make(-12, 10, 0), make(1, 100, 90), make(13, 200, 100), make(20, 205, 5)];
  const week = periodGrowth(accountWindow(history, '7'));
  assert.deepEqual(week.map(point => point.counters.views), [0, 5]);
  assert.equal(week.at(-1)?.followers, 7);
  assert.deepEqual(periodGrowth(accountWindow(history, '30')).map(p => p.counters.views), [0, 100, 105]);
  assert.equal(accountWindow(history, 'all').at(-1)?.counters.views, 205);
  assert.deepEqual(periodGrowth(history.slice(-1)), []);
  assert.equal(periodGrowth([history[0], {...history[1], change: undefined}])[1].counters.views, undefined);
});
