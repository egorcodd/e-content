import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  await page.goto((process.env.PREVIEW_URL || 'http://127.0.0.1:5186') + '/sources');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  const checks = await page.evaluate(async () => {
    const {
      resolveCollectionSettings,
      migrateConfiguration,
      validateConfiguration,
      buildCollectionPlan,
    } = await import('/src/features/sources/collection-policy.ts');
    const { defaultSettings, defaultPlatformSettings, defaultRunLimits } =
      await import('/src/features/sources/model.ts');
    const { saveCollectionSettings, savePlatformSettings, saveSource } =
      await import('/src/features/sources/repository.ts');
    let count = 0;
    const check = (condition, label) => {
      if (!condition) throw new Error(label);
      count++;
    };
    const throws = (callback, label) => {
      let failed = false;
      try {
        callback();
      } catch {
        failed = true;
      }
      check(failed, label);
    };
    const make = () => ({
      schemaVersion: 2,
      sources: [],
      settings: { ...defaultSettings },
      platforms: structuredClone(defaultPlatformSettings),
      runLimits: { ...defaultRunLimits },
    });
    const tg = {
      id: 'tg',
      platform: 'telegram',
      kind: 'channel',
      title: 'QA',
      url: 'https://t.me/qualityqa',
      accountId: null,
      purpose: 'inspiration',
      enabled: true,
      createdAt: '2026-11-01T00:00:00.000Z',
    };
    const tt = {
      ...tg,
      id: 'tt',
      platform: 'tiktok',
      kind: 'video',
      url: 'https://www.tiktok.com/@qualityqa/video/123456',
    };
    const access = (source, patch = {}) => ({
      sourceId: source.id,
      platform: source.platform,
      connectorId: 'verified-adapter',
      accountId: null,
      status: 'ready',
      capabilities: [
        'publicationText',
        'publicationDates',
        'comments',
        'commentDates',
        'replies',
        'forwardedMetadata',
        'publicMetrics',
        'commentLikes',
      ],
      commentOrders: ['platform'],
      ...patch,
    });
    const compile = (config, entries = config.sources.map((source) => access(source))) =>
      buildCollectionPlan(config, { at: '2026-11-16T12:00:00Z', access: entries });

    const resolved = resolveCollectionSettings(
      { ...defaultSettings, period: '7' },
      { maxComments: 250 },
    );
    check(
      resolved.values.period === '7' && resolved.values.maxComments === 250,
      'Independent field inheritance',
    );
    check(
      resolved.origins.period === 'defaults' && resolved.origins.maxComments === 'platform',
      'Field origins',
    );
    const explicit = resolveCollectionSettings(defaultSettings, {
      comments: false,
      maxComments: 0,
      period: '30',
    });
    check(
      !explicit.values.comments &&
        explicit.values.maxComments === 0 &&
        explicit.origins.period === 'platform',
      'Preserve false, zero and explicit equal values',
    );
    throws(
      () => resolveCollectionSettings(defaultSettings, { comments: false, publications: false }),
      'Reject effective empty selection',
    );
    throws(
      () => resolveCollectionSettings(defaultSettings, { maxComments: -1 }),
      'Reject invalid override',
    );

    const old = make();
    delete old.schemaVersion;
    old.sources = [tg];
    old.platforms.telegram.custom = { ...defaultSettings, maxComments: 250 };
    const migrated = migrateConfiguration(old);
    check(
      JSON.stringify(migrated.platforms.telegram.custom) === '{"maxComments":250}',
      'Legacy copies become only differences',
    );
    check(
      migrated.sources[0].id === 'tg' && migrated.schemaVersion === 2,
      'Migration preserves sources',
    );
    check(
      JSON.stringify(migrateConfiguration(migrated)) === JSON.stringify(migrated),
      'Migration is idempotent',
    );
    migrated.platforms.telegram.custom.period = '30';
    check(
      migrateConfiguration(migrated).platforms.telegram.custom.period === '30',
      'Version 2 keeps explicit equal override',
    );

    const config = make();
    config.sources = structuredClone([tg, tt]);
    config.platforms.telegram.custom = { period: '7', maxComments: 250 };
    const plan = compile(config);
    check(plan.status === 'ready' && plan.jobs.length === 2, 'Compile both kinds');
    check(
      compile(config, [
        access(tg),
        access(tt, {
          capabilities: access(tt).capabilities.filter((value) => value !== 'commentDates'),
        }),
      ]).status === 'blocked',
      'Period requires comment timestamps from adapter',
    );
    check(
      plan.jobs[0].limits.publications === 50 && plan.jobs[1].limits.publications === 1,
      'Single publication vs channel limits',
    );
    check(
      plan.jobs[0].limits.comments === 250 && plan.jobs[1].limits.comments === 1000,
      'Comment cap per source',
    );
    check(
      plan.jobs[0].window.since === '2026-11-09T12:00:00.000Z' &&
        plan.jobs[1].window.since === '2026-10-17T12:00:00.000Z',
      'Fixed separate period windows',
    );
    check(
      Object.isFrozen(plan.jobs[0].options) && Object.isFrozen(plan.limits),
      'Deep immutable plan',
    );
    config.settings.maxComments = 5;
    check(plan.jobs[1].limits.comments === 1000, 'Running snapshot unaffected by editing settings');
    config.settings.maxComments = 1000;
    config.platforms.tiktok.minLikes = 80;
    check(
      compile(config).jobs[1].options.minLikes === 80 &&
        compile(config).jobs[0].options.minLikes === 0,
      'Platform-only filters',
    );
    const noLikes = compile(config, [
      access(tg),
      access(tt, {
        capabilities: access(tt).capabilities.filter((value) => value !== 'commentLikes'),
      }),
    ]);
    check(
      noLikes.status === 'blocked' && noLikes.issues.some((issue) => issue.sourceId === 'tt'),
      'No silent unsupported filter fallback',
    );
    config.platforms.tiktok.minLikes = 0;
    config.settings.metrics = true;
    check(
      compile(config).jobs.every((job) => job.outputs.metrics === 'public'),
      'Public counters stay public',
    );
    config.sources[0].purpose = 'own';
    check(
      compile(config).jobs[0].outputs.metrics === 'public',
      'Own-content label grants no admin rights',
    );
    check(
      compile(config, [
        access(tg, { capabilities: [...access(tg).capabilities, 'ownerMetrics'] }),
        access(tt),
      ]).jobs[0].outputs.metrics === 'owner',
      'Owner metrics need verified capability',
    );
    check(
      compile(config, [
        access(tg, {
          capabilities: access(tg).capabilities.filter((value) => value !== 'publicMetrics'),
        }),
        access(tt),
      ]).status === 'blocked',
      'Unsupported metrics block plan',
    );
    config.settings.metrics = false;
    check(compile(config, []).status === 'blocked', 'No access means no runnable plan');
    check(
      compile(config, [access(tg, { accountId: 'preview:telegram' }), access(tt)]).status ===
        'blocked',
      'Preview identities cannot run',
    );
    config.sources[0].accountId = 'account-a';
    check(
      compile(config).issues.some((issue) => issue.code === 'account'),
      'Account binding is checked',
    );
    config.sources[0].accountId = null;
    config.platforms.tiktok.order = 'recent';
    check(
      compile(config).issues.some((issue) => issue.code === 'comment-order'),
      'Unsupported sort is not assumed',
    );
    config.platforms.tiktok.order = 'platform';
    config.runLimits.maxComments = 0;
    check(
      compile(config).status === 'ready' &&
        compile(config).jobs.every((job) => !job.outputs.comments && !job.options.includeReplies),
      'Zero comment budget still allows publications',
    );
    config.runLimits.maxPublications = 0;
    check(
      compile(config, []).status === 'empty',
      'Zero publication budget performs no access work',
    );
    config.runLimits = { ...defaultRunLimits, maxRequests: 0 };
    check(compile(config, []).jobs.length === 0, 'Zero requests creates no jobs');
    config.runLimits = { maxRequests: 10, maxPublications: 3, maxComments: 8 };
    check(
      compile(config).jobs[0].limits.publications === 3 &&
        compile(config).jobs[0].limits.comments === 8,
      'Local limits cannot exceed run budget',
    );
    config.sources.forEach((source) => (source.enabled = false));
    check(compile(config, []).status === 'empty', 'Disabled sources require no access');
    config.sources[0].enabled = true;
    config.sources[0].kind = 'video';
    check(compile(config).issues[0].code === 'source-kind', 'Invalid source kind rejected');
    config.sources[0].url = 'https://example.com';
    check(compile(config).issues[0].code === 'source-url', 'Invalid URL gives source issue');
    throws(
      () =>
        validateConfiguration({ ...make(), runLimits: { ...defaultRunLimits, maxRequests: -1 } }),
      'Invalid run budget',
    );

    saveSource(tg);
    savePlatformSettings('telegram', {
      ...defaultPlatformSettings.telegram,
      custom: { maxComments: 250 },
    });
    saveCollectionSettings({ ...defaultSettings, period: '7' });
    const stored = () => JSON.parse(localStorage.getItem('e-content-sources-v1'));
    check(
      stored().sources.length === 1 && stored().platforms.telegram.custom.maxComments === 250,
      'Saving defaults preserves sources and overrides',
    );
    savePlatformSettings('telegram', {
      ...defaultPlatformSettings.telegram,
      custom: { comments: false },
    });
    const before = localStorage.getItem('e-content-sources-v1');
    throws(
      () => saveCollectionSettings({ ...defaultSettings, publications: false }),
      'Reject conflicting merged configuration',
    );
    check(localStorage.getItem('e-content-sources-v1') === before, 'Invalid save is atomic');
    savePlatformSettings('telegram', {
      ...defaultPlatformSettings.telegram,
      custom: { maxComments: 250 },
    });
    return count;
  });
  await page.reload();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('complementary', { name: 'Параметры Telegram', exact: true }).waitFor();
  fs.mkdirSync('.qa/collection-policy', { recursive: true });
  for (const width of [1500, 768, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.waitForTimeout(350);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Overflow at ${width}`,
    );
    await page.screenshot({ path: `.qa/collection-policy/${width}.png`, fullPage: true });
  }
  console.log(
    `Collection policy passed: ${checks} checks for inheritance, migration, source capabilities, budgets, immutable jobs and atomic persistence; 3 widths.`,
  );
} finally {
  await browser.close();
}
