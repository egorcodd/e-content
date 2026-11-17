import { FixtureTikTokReader, tiktokConfiguration } from './tiktok-worker-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, configuration, finish } from './fixtures.ts';
import { parseVideo } from '../tiktok/parser.ts';
import { rawVideo } from './tiktok-fixtures.ts';
import { AppError } from '../errors.ts';

test('partial TikTok collection keeps raw records and promotes only supported themes', async () => {
  const raw = [
    'Конкурентов убираешь или что? Серьёзно?',
    'Хочу перейти в кибербезопасность, что стоит изучить в первую очередь?',
    'Подскажи, с чего начать путь в информационной безопасности без опыта?',
    'Хочу перейти в кибербезопасность, что стоит изучить в первую очередь?!',
    'Как найти клиентов фрилансеру, когда уже умеешь писать сайты?',
    'Мне нравится Python и вообще сегодня хорошее настроение.',
    'А ты где учился и сколько работаешь? Просто интересно.',
    'Я получил офер, прошёл собес и теперь работаю уже три года.',
    'Скажу по опыту, чтобы стать инженером, надо быть и фронтендером, и девопсом.',
    'Отлично, так как сейчас кибер безопасности нет и что будет дальше неизвестно.',
    'Ты идиот, что нужно учить, чтобы начать в кибербезопасности?',
    'С чего начать в кибербезопасности, если знаю только Python?',
  ];
  const f = await fixture({
    tiktokReaderFactory: () => ({
      async read(_source, options) {
        await options.beforeRequest('data');
        const video = parseVideo(rawVideo);
        options.onVideo(video);
        options.onProgress({
          status: 'reading',
          url: video.url,
          comments: 0,
          videos: { processed: 1, selected: 3 },
        });
        for (const [index, text] of raw.entries())
          options.onComment(
            {
              id: `80000000000000000${index}`,
              videoId: video.id,
              parentId: index === raw.length - 1 ? '800000000000000001' : undefined,
              text,
              publishedAt: video.publishedAt,
            },
            video,
          );
        throw new AppError(
          429,
          'TIKTOK_BLOCKED',
          'TikTok ограничил запросы. Собранные данные сохранены.',
        );
      },
    }),
  });
  try {
    await f.app.engine.start('tiktok-editorial-filter', 'tiktok', tiktokConfiguration());
    const run = await finish(f.app, 'tiktok-editorial-filter');
    assert.equal(run.status, 'partial');
    assert.equal(run.counts.comments, raw.length);
    assert.equal(run.sources?.['tiktok-source'].videos?.processed, 1);
    assert.equal(run.ideas.length, 1);
    assert.equal(run.ideas[0].title, 'С чего начать в кибербезопасности');
    assert.deepEqual(
      run.ideas[0].evidence.map(({ text }) => text),
      raw.slice(1, 3),
    );
    assert.doesNotMatch(run.ideas[0].body, /Хочу перейти|Подскажи/);
    const review = await f.request('/collection/reviewed-ideas');
    assert.deepEqual(review.data.ideas, run.ideas);
  } finally {
    await f.close();
  }
});

test('TikTok-only worker needs no account, retains long IDs and creates video ideas with evidence', async () => {
  const f = await fixture({ tiktokReaderFactory: () => new FixtureTikTokReader() });
  try {
    await f.request('/connections');
    const started = await f.request('/collection/runs', 'POST', {
      id: 'tiktok-worker-success',
      mode: 'tiktok',
      configuration: tiktokConfiguration(),
    });
    assert.equal(started.status, 202);
    const run = await finish(f.app, 'tiktok-worker-success');
    assert.equal(run.status, 'completed');
    assert.equal(run.counts.comments, 3);
    assert.equal(run.counts.ideas, 1);
    assert.ok(run.done.includes('tiktok'));
    assert.ok(run.done.includes('orchestrator'));
    assert.deepEqual(f.gateway.calls, []);
    assert.equal(f.app.account.accounts().length, 0);
    const saved = f.app.store.records(run.id).find((record) => record.kind === 'comment');
    assert.equal(saved?.platform, 'tiktok');
    if (saved?.platform === 'tiktok') assert.equal(saved.commentId, '9000000000000000001');
    assert.equal(run.ideas[0].source, 'tiktok');
    assert.equal(run.ideas[0].format, 'video');
    assert.equal(run.ideas[0].evidence.length, 3);
    assert.equal((await f.request('/connections')).data.publicReaders.tiktok.status, 'completed');
    const download = await f.request(`/collection/runs/${run.id}/export.md`);
    assert.match(download.data, /TikTok/);
    assert.match(download.data, /comment_id=9000000000000000001/);
  } finally {
    await f.close();
  }
});
test('login requirement keeps real metadata, exposes partial state and never claims comments completed', async () => {
  const f = await fixture({ tiktokReaderFactory: () => new FixtureTikTokReader('login') });
  try {
    await f.app.engine.start('tiktok-worker-login', 'cycle', tiktokConfiguration());
    const run = await finish(f.app, 'tiktok-worker-login');
    assert.equal(run.status, 'partial');
    assert.equal(run.counts.posts, 1);
    assert.equal(run.counts.comments, 0);
    assert.ok(!run.done.includes('tiktok'));
    assert.ok(!run.done.includes('comments'));
    assert.ok(run.failures?.tiktok);
    assert.equal(run.sources?.['tiktok-source'].status, 'login_required');
    await f.request('/connections');
    assert.equal(
      (await f.request('/connections')).data.publicReaders.tiktok.status,
      'login_required',
    );
    assert.deepEqual(f.gateway.calls, []);
  } finally {
    await f.close();
  }
});
test('mixed cycle retains TikTok when Telegram lacks authorization and respects comment filters and budgets', async () => {
  const f = await fixture({ tiktokReaderFactory: () => new FixtureTikTokReader() });
  try {
    const config = tiktokConfiguration();
    config.sources.push(...configuration().sources);
    config.runLimits.maxComments = 2;
    await f.app.engine.start('tiktok-mixed-partial', 'cycle', config);
    const run = await finish(f.app, 'tiktok-mixed-partial');
    assert.equal(run.status, 'partial');
    assert.ok(run.failures?.telegram);
    assert.equal(run.counts.comments, 2);
    assert.equal(run.counts.ideas, 1);
    assert.equal(run.sources?.['tiktok-source'].status, 'limited');
    const filtered = tiktokConfiguration();
    filtered.platforms.tiktok.minLikes = 6;
    await f.app.engine.start('tiktok-likes-filter', 'tiktok', filtered);
    const noMatches = await finish(f.app, 'tiktok-likes-filter');
    assert.equal(noMatches.status, 'completed');
    assert.equal(noMatches.counts.comments, 0);
    assert.equal(noMatches.counts.ideas, 0);
    await f.app.engine.start('tiktok-local-analysis', 'ideas', config);
    const local = await finish(f.app, 'tiktok-local-analysis');
    assert.equal(local.counts.requests, 0);
  } finally {
    await f.close();
  }
});
test('cancelled guest source stops reading and preserves its metadata and status', async () => {
  const f = await fixture({ tiktokReaderFactory: () => new FixtureTikTokReader('cancel') });
  try {
    const id = 'tiktok-cancelled-run';
    await f.app.engine.start(id, 'tiktok', tiktokConfiguration());
    for (let i = 0; i < 50 && !f.app.store.run(id)?.counts.posts; i++) await delay(10);
    f.app.engine.cancel(id);
    const run = await finish(f.app, id);
    assert.equal(run.status, 'cancelled');
    assert.equal(run.counts.posts, 1);
    assert.equal(run.sources?.['tiktok-source'].status, 'cancelled');
  } finally {
    await f.close();
  }
});
