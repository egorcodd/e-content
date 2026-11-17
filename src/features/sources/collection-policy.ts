import {
  collectionFields,
  defaultPlatformSettings,
  defaultRunLimits,
  defaultSettings,
  parseSource,
  platformNames,
  validateOverrides,
  validatePlatformSettings,
  validateRunLimits,
  validateSettings,
  type AnalysisSource,
  type CollectionOverrides,
  type CollectionSettings,
  type CommentOrder,
  type Platform,
  type PlatformSettings,
  type RunLimits,
  type SourceConfiguration,
} from './model';

export function resolveCollectionSettings(
  defaults: CollectionSettings,
  overrides: CollectionOverrides | null,
) {
  const patch = validateOverrides(overrides);
  const values = validateSettings({ ...validateSettings(defaults), ...patch });
  const origins = Object.fromEntries(
    collectionFields.map((key) => [
      key,
      patch && Object.hasOwn(patch, key) ? 'platform' : 'defaults',
    ]),
  ) as Record<keyof CollectionSettings, 'defaults' | 'platform'>;
  return { values, origins };
}

export function validateConfiguration(configuration: SourceConfiguration): SourceConfiguration {
  const settings = validateSettings(configuration.settings);
  const platforms = validatePlatformSettings(configuration.platforms);
  for (const platform of ['telegram', 'tiktok'] as const) {
    try {
      resolveCollectionSettings(settings, platforms[platform].custom);
    } catch {
      throw new Error(
        `${platformNames[platform]}: выберите хотя бы один тип данных в итоговых параметрах.`,
      );
    }
  }
  return {
    ...configuration,
    schemaVersion: 2,
    settings,
    platforms,
    runLimits: validateRunLimits(configuration.runLimits),
  };
}

export function migrateConfiguration(
  stored: Omit<Partial<SourceConfiguration>, 'schemaVersion'> & { schemaVersion?: number },
): SourceConfiguration {
  const settings = validateSettings(stored.settings ?? defaultSettings);
  let platforms = validatePlatformSettings(stored.platforms ?? defaultPlatformSettings);
  if (stored.schemaVersion !== 2) {
    platforms = structuredClone(platforms);
    for (const platform of ['telegram', 'tiktok'] as const) {
      const copy = platforms[platform].custom;
      if (copy)
        platforms[platform].custom = Object.fromEntries(
          Object.entries(copy).filter(
            ([key, value]) => value !== settings[key as keyof CollectionSettings],
          ),
        );
    }
  }
  return validateConfiguration({
    schemaVersion: 2,
    sources: stored.sources ?? [],
    settings,
    platforms,
    runLimits: stored.runLimits ?? defaultRunLimits,
  });
}

export type AdapterCapability =
  | 'publicationText'
  | 'publicationDates'
  | 'comments'
  | 'commentDates'
  | 'replies'
  | 'publicMetrics'
  | 'ownerMetrics'
  | 'commentLikes'
  | 'forwardedMetadata';
export type SourceAccess = {
  sourceId: string;
  platform: Platform;
  connectorId: string;
  accountId: string | null;
  status: 'ready' | 'unverified' | 'denied';
  capabilities: readonly AdapterCapability[];
  commentOrders: readonly CommentOrder[];
};
type SourceIssue = { sourceId: string; code: string; message: string };
export type CollectionJob = {
  source: AnalysisSource;
  connectorId: string;
  window: { since: string; until: string };
  outputs: { publications: boolean; comments: boolean; metrics: 'none' | 'public' | 'owner' };
  limits: { publications: number; comments: number };
  options: {
    includeReplies: boolean;
    includeForwarded: boolean;
    minLength: number;
    minLikes: number;
    commentOrder: CommentOrder;
  };
  origins: ReturnType<typeof resolveCollectionSettings>['origins'];
};

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
function freeze<T>(value: T): Immutable<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

/** Compiles a snapshot; it never authenticates, fetches data or launches a worker. */
export function buildCollectionPlan(
  configuration: SourceConfiguration,
  context: { at: string; access: readonly SourceAccess[] },
) {
  const config = validateConfiguration(structuredClone(configuration));
  if (!Number.isFinite(Date.parse(context.at))) throw new Error('Укажите время запуска.');
  const until = new Date(context.at).toISOString();
  const jobs: CollectionJob[] = [],
    issues: SourceIssue[] = [],
    skipped: { sourceId: string; reason: string }[] = [];
  const ids = new Set<string>();
  for (const source of config.sources) {
    const issue = (code: string, message: string) =>
      issues.push({ sourceId: source.id, code, message });
    if (ids.has(source.id)) throw new Error('Повтор ID источника.');
    ids.add(source.id);
    if (!source.enabled) {
      skipped.push({ sourceId: source.id, reason: 'disabled' });
      continue;
    }
    let parsed: ReturnType<typeof parseSource>;
    try {
      parsed = parseSource(source.url, source.platform);
    } catch {
      issue('source-url', 'Проверьте ссылку и площадку источника.');
      continue;
    }
    if (parsed.kind !== source.kind) {
      issue('source-kind', 'Формат источника не соответствует ссылке.');
      continue;
    }
    const { values, origins } = resolveCollectionSettings(
      config.settings,
      config.platforms[source.platform].custom,
    );
    const single = source.kind === 'video' || source.kind === 'publication';
    const publications = Math.min(
      single ? 1 : values.maxPublications,
      values.maxPublications,
      config.runLimits.maxPublications,
    );
    const commentLimit =
      source.platform === 'tiktok' && config.platforms.tiktok.commentsPerVideo !== undefined
        ? config.runLimits.maxComments
        : Math.min(values.maxComments, config.runLimits.maxComments);
    const comments = values.comments && commentLimit > 0;
    if (
      !publications ||
      !config.runLimits.maxRequests ||
      (!values.publications && !comments && !values.metrics)
    ) {
      skipped.push({ sourceId: source.id, reason: 'zero-limit' });
      continue;
    }
    const candidates = context.access.filter((access) => access.sourceId === source.id);
    const access = candidates[0];
    if (
      candidates.length !== 1 ||
      !access ||
      access.status !== 'ready' ||
      access.platform !== source.platform ||
      !access.connectorId ||
      access.connectorId.startsWith('preview:') ||
      access.accountId?.startsWith('preview:') ||
      source.accountId?.startsWith('preview:')
    ) {
      issue('access', 'Нужна подтверждённая проверка доступа к источнику.');
      continue;
    }
    if (source.accountId && source.accountId !== access.accountId) {
      issue('account', 'Доступ подтверждён для другого аккаунта.');
      continue;
    }
    const telegram = config.platforms.telegram,
      tiktok = config.platforms.tiktok;
    const includeReplies =
      comments && (source.platform === 'telegram' ? telegram.threads : tiktok.replies);
    const required: AdapterCapability[] = ['publicationDates'];
    if (values.publications) required.push('publicationText');
    if (comments) required.push('comments', 'commentDates');
    if (includeReplies) required.push('replies');
    if (source.platform === 'telegram' && !telegram.forwards) required.push('forwardedMetadata');
    if (source.platform === 'tiktok' && comments && tiktok.minLikes > 0)
      required.push('commentLikes');
    const metrics = values.metrics
      ? access.capabilities.includes('ownerMetrics')
        ? 'owner'
        : access.capabilities.includes('publicMetrics')
          ? 'public'
          : 'none'
      : 'none';
    const unsupported = required.filter((capability) => !access.capabilities.includes(capability));
    if (values.metrics && metrics === 'none') unsupported.push('publicMetrics');
    const order = source.platform === 'tiktok' && comments ? tiktok.order : 'platform';
    if (comments && !access.commentOrders.includes(order))
      issue('comment-order', 'Коннектор не подтверждает выбранный порядок комментариев.');
    if (unsupported.length)
      issue(
        'capability',
        `Коннектор не подтверждает возможности: ${[...new Set(unsupported)].join(', ')}.`,
      );
    if (issues.some((item) => item.sourceId === source.id)) continue;
    jobs.push({
      source: { ...source, url: parsed.url },
      connectorId: access.connectorId,
      window: {
        since: new Date(Date.parse(until) - Number(values.period) * 86400000).toISOString(),
        until,
      },
      outputs: { publications: values.publications, comments, metrics },
      limits: { publications, comments: comments ? commentLimit : 0 },
      options: {
        includeReplies,
        includeForwarded: source.platform === 'telegram' && telegram.forwards,
        minLength: comments && source.platform === 'telegram' ? telegram.minLength : 0,
        minLikes: comments && source.platform === 'tiktok' ? tiktok.minLikes : 0,
        commentOrder: order,
      },
      origins,
    });
  }
  return freeze({
    createdAt: until,
    status: issues.length ? 'blocked' : !jobs.length ? 'empty' : 'ready',
    jobs,
    issues,
    skipped,
    limits: { ...config.runLimits },
  });
}
