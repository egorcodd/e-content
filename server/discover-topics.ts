import { createHash } from 'node:crypto';
import type { CollectedRecord, FoundIdea } from '../src/features/collection/contracts.ts';
import type { AudienceRole } from './problem-signals.ts';

export type AudienceSignal = {
  record: CollectedRecord;
  thread: string;
  text: string;
  role: AudienceRole;
};

type Draft = Pick<FoundIdea, 'title' | 'body'>;
export type TopicCue = AudienceSignal &
  Draft & {
    key: string;
    confirmation: 'question-pair' | 'question-with-complaint';
    contextual?: boolean;
  };

const intentPatterns = [
  ['start', /с чего начать|как начать|первые шаги|how to start|getting started/i],
  [
    'choice',
    /выбр|лучше|стоит|сравн|\bvs\b|како[йг]|какую|какие|какая|насч[её]т|норм(?:\s|\?|$)|which|better/i,
  ],
  ['problem', /почему|не получается|не работ|ошибк|проблем|why|doesn't work|error/i],
] as const;
type Intent = (typeof intentPatterns)[number][0] | 'how';

const common = new Set(
  (
    'the and for that this from what which how why when with can you your would about have does should ' +
    'это эта этот эти такой такое там тут как что где чем какой какая какое какого какую какие когда куда ' +
    'не ни ты мы вы он ей их им ее по во со от ко за на до об из то же ли бы ну да но ой для под над при без или раз про or to is it of in at an ' +
    'кто почему чего если где сколько можно надо нужно чтобы хотя просто тоже вообще пока уже даже ' +
    'сейчас только очень еще потом после через так вот типа словно весь почти именно такой ' +
    'уже еще всем все вас ваш моя мой моей тебя твой тебе свой мне меня свои сама сам себя всем ' +
    'будет будут был было быть есть нет хочу могу смогу лучше стоит делать норм первый ' +
    'плиз привет бро брат друг друзья родной радной ребята пожалуйста подскажите посоветуйте ' +
    'начать выбрать сделать изучить пойти нужно уметь выучить думаешь хороший правда вопрос насчет ' +
    'путь совет тема направление человек говорить сказать знать думать знать интерес ' +
    'работа опыт вообще способ вариант задача время год учиться'
  ).split(' '),
);

const filler =
  /^(?:(?:а|бро|ребята|друзья|привет|приветствую|слушай|родной|радной|братан|пожалуйста|подскажи(?:те)?|посоветуй(?:те)?|расскажи(?:те)?)[\s,!:]+)+/iu;
const personal =
  /(?:^|\s)(?:я|мне|меня|ты|тебе|тебя|у меня|мне нужен|нам|my|me|you)(?:\s|$)|\d{2}\s*(?:лет|года)|https?:|@/iu;

export function topicTerms(text: string) {
  return (
    text
      .toLowerCase()
      .replaceAll('ё', 'е')
      .match(/[\p{L}][\p{L}\d+#-]*/gu) ?? []
  )
    .filter((word) => (word.length >= 3 || /^[a-z]{2}$/iu.test(word)) && !common.has(word))
    .map((word) => {
      const stem = word.replace(
        /(?:иями|ями|ами|ого|ему|ыми|ими|ия|ии|ий|ый|ая|ое|ую|ые|ие|ей|ям|ах|ов|ев|ом|ем|ою|а|я|ы|и|е|у|ю|ь)$/u,
        '',
      );
      return stem.length >= 4 ? stem : word;
    })
    .filter((word) => !common.has(word));
}

type Fingerprint = AudienceSignal & { full: Set<string> };
type Signal = Fingerprint & { intent: Intent; terms: Set<string> };

function fingerprint(entry: AudienceSignal): Fingerprint {
  return {
    ...entry,
    full: new Set(
      entry.record.text
        .toLowerCase()
        .replaceAll('ё', 'е')
        .match(/[\p{L}\d]+/gu),
    ),
  };
}

function signal(entry: AudienceSignal): Signal {
  return {
    ...fingerprint(entry),
    intent: intentPatterns.find(([, pattern]) => pattern.test(entry.text))?.[0] ?? 'how',
    terms: new Set(topicTerms(entry.text)),
  };
}

function overlap<T>(a: Set<T>, b: Set<T>) {
  let shared = 0;
  for (const key of a) if (b.has(key)) shared++;
  return shared;
}

function nearCopy(a: Fingerprint, b: Fingerprint) {
  const shared = overlap(a.full, b.full);
  return shared / (a.full.size + b.full.size - shared) >= 0.85;
}

function groupQuestions(entries: Signal[]) {
  const questions = entries.filter(({ role }) => role === 'question');
  const complaints = entries.filter(({ role }) => role === 'complaint');
  const frequency = new Map<string, number>();
  for (const entry of entries)
    for (const term of entry.terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const groups = new Map<string, Signal[]>();
  for (const entry of [...questions, ...complaints]) {
    const intents = entry.role === 'question' ? [entry.intent] : ['how', 'problem'];
    const keys = [...entry.terms]
      .filter(
        (term) =>
          frequency.get(term)! >= 2 && frequency.get(term)! <= Math.max(8, entries.length / 3),
      )
      .sort((a, b) => frequency.get(a)! - frequency.get(b)! || a.localeCompare(b))
      .slice(0, 10)
      .sort();
    for (const [i, first] of keys.entries()) {
      for (const second of keys.slice(i + 1)) {
        for (const intent of intents) {
          const key = `${entry.record.platform}:${intent}:${first}:${second}`;
          const group = groups.get(key) ?? [];
          if (
            entry.role === 'complaint' &&
            !group.some(
              (question) =>
                question.role === 'question' &&
                overlap(question.terms, entry.terms) >=
                  Math.max(3, Math.ceil(question.terms.size * 0.75)),
            )
          )
            continue;
          if (
            group.length >= 100 ||
            group.some((item) => item.thread === entry.thread || nearCopy(item, entry))
          )
            continue;
          group.push(entry);
          groups.set(key, group);
        }
      }
    }
  }
  return [...groups]
    .filter(([, group]) => group.length >= 2)
    .sort(([left, a], [right, b]) => b.length - a.length || left.localeCompare(right));
}

const editorial = {
  start: {
    label: 'Первые шаги',
    plan: 'Показать, с чего начать, на одном небольшом примере. Отдельно показать, как проверить первый результат.',
  },
  choice: {
    label: 'Как выбрать подходящий вариант',
    plan: 'Сравнить варианты на одном примере, назвать критерии выбора и разобрать, когда каждый из них подходит.',
  },
  problem: {
    label: 'Как найти причину',
    plan: 'Показать, как воспроизвести проблему, последовательно проверить причины и убедиться, что решение сработало.',
  },
  how: {
    label: 'Практический разбор',
    plan: 'Разобрать вопрос на конкретном примере. Показать последовательность действий и способ проверить результат.',
  },
};

function heading(text: string) {
  return text.replace(/^(?:[a-z]{2,3}(?=\s)|.)/iu, (first) => first.toUpperCase());
}

function sharedPhrase(core: string, anchors: string[]) {
  const words = [...core.matchAll(/[\p{L}][\p{L}\d+#-]*/gu)];
  const positions = words.flatMap(([word], index) =>
    anchors.some((anchor) => topicTerms(word).includes(anchor)) ? [index] : [],
  );
  const first = positions.at(0);
  const last = positions.at(-1);
  if (first === undefined || last === undefined || last - first > 5) return;
  return words
    .slice(first, last + 1)
    .map(([word]) => word)
    .join(' ')
    .replace(/\s+подход(?:ит|ят)\s+(?=для\s)/iu, ' ');
}

function titleFor(core: string, intent: Intent, anchors: string[]) {
  const selection = core.match(/^как(?:ую|ой|ие|ое)\s+(.+?)\s+(?:выбрать|лучше взять)(.*)$/iu);
  if (selection) return `Как выбрать ${selection[1]}${selection[2]}`;
  const alternatives = core.match(/^(.+?)\?\s+(?:или|либо|or)\s+(?:вс[её][\s-]+таки\s+)?(.+)$/iu);
  if (intent === 'choice' && alternatives) {
    const left = alternatives[1].replace(/\s+(?:норм(?:ально)?|подойд[её]т)$/iu, '');
    return `${heading(left)} или ${alternatives[2]} — что выбрать`;
  }
  const comparison = core
    .replace(/^(?:что|как) насч[её]т\s+/iu, '')
    .replace(/\s+норм(?:ально)?$/iu, '');
  if (intent === 'choice' && comparison !== core) return `${heading(comparison)} — что выбрать`;
  const steps = core.match(/^(?:как|с чего) начать\s+((?:в|с|со|на)\s+.+)/iu)?.[1];
  if (steps) return `Первые шаги ${steps}`;
  const cause = core.match(/^почему\s+(.+)/iu)?.[1];
  if (cause) return `${heading(cause)} — как найти причину`;
  const action = core.match(/^как\s+(.+)/iu)?.[1];
  if (action) return `${heading(action)} — пошаговый разбор`;
  const phrase = sharedPhrase(core, anchors);
  if (phrase) return `${heading(phrase)} — ${editorial[intent].label.toLowerCase()}`;
}

function outline(question: Signal, anchors: string[]) {
  const core = question.text
    .replace(filler, '')
    .trim()
    .replace(/[?!.,]+$/u, '')
    .trim();
  const supported = new Set(topicTerms(core));
  if (personal.test(core) || core.length > 96 || !anchors.every((anchor) => supported.has(anchor)))
    return;
  const rewritten = titleFor(core, question.intent, anchors);
  if (!rewritten) return;
  const title = rewritten
    .replace(/\b([A-Z]{2,4}) (?=[а-яёА-ЯЁ]{4})/g, '$1-')
    .replace(/(^|\s)(дата) (инженер)/giu, '$1$2-$3');
  return { title, body: `# ${title}\n\n${editorial[question.intent].plan}` };
}

export function evidenceFor(record: CollectedRecord): FoundIdea['evidence'][number] {
  return {
    id: record.id,
    source: record.platform,
    kind: record.kind,
    text: record.text,
    url: record.url,
    publicationId: record.publicationId,
    publishedAt: record.publishedAt ?? undefined,
  };
}

function discoveredIdea(key: string, draft: Draft, group: AudienceSignal[]): FoundIdea {
  const platform = group[0].record.platform;
  return {
    ...draft,
    id: `${platform}-discovered-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`,
    source: platform,
    format: platform === 'tiktok' ? 'video' : 'undecided',
    evidence: group.map(({ record }) => evidenceFor(record)),
  };
}

function discoverConfirmedCues(cues: TopicCue[]) {
  type Entry = Fingerprint & Pick<TopicCue, 'contextual'>;
  const groups = new Map<
    string,
    { entries: Entry[]; draft: Draft; confirmation: TopicCue['confirmation'] }
  >();
  const ordered = [
    ...cues.filter(({ contextual }) => !contextual),
    ...cues.filter(({ contextual }) => contextual),
  ];
  for (const cue of ordered) {
    const scope = cue.confirmation === 'question-pair' ? 'question' : 'recurring-problem';
    const key = `${cue.record.platform}:${scope}:${cue.key}`;
    const group = groups.get(key) ?? {
      entries: [],
      draft: { title: cue.title, body: cue.body },
      confirmation: cue.confirmation,
    };
    const entry = { ...fingerprint(cue), contextual: cue.contextual };
    const sameRole = group.entries.filter((item) => item.role === entry.role);
    if (
      sameRole.length >= 100 ||
      sameRole.some((item) => item.thread === entry.thread || nearCopy(item, entry))
    )
      continue;
    group.entries.push(entry);
    groups.set(key, group);
  }
  const seenComparisons = new Set<string>();
  return [...groups].flatMap(([key, { entries, draft, confirmation }]) => {
    const questions = entries.filter(({ role }) => role === 'question');
    const complaints = entries.filter(({ role }) => role === 'complaint');
    const supporters = confirmation === 'question-pair' ? questions : complaints;
    const sharesContext = (entry: Entry, question: Entry) =>
      !entry.contextual || entry.record.publicationId === question.record.publicationId;
    const lead = questions.find(
      (question) =>
        !question.contextual &&
        supporters.some(
          (entry) =>
            entry.thread !== question.thread &&
            sharesContext(entry, question) &&
            !nearCopy(entry, question),
        ),
    );
    if (!lead) return [];
    const support = [lead];
    for (const entry of [...complaints, ...questions]) {
      if (support.length >= 100) break;
      if (!sharesContext(entry, lead)) continue;
      if (!support.some((item) => item.thread === entry.thread || nearCopy(item, entry)))
        support.push(entry);
    }
    if (key.includes(':question:career-choice:')) {
      const evidence = support
        .map(({ record }) => record.id)
        .sort()
        .join('\n');
      if (seenComparisons.has(evidence)) return [];
      seenComparisons.add(evidence);
    }
    return [discoveredIdea(key, draft, support)];
  });
}

export function discoverTopics(
  signals: AudienceSignal[],
  established: FoundIdea[],
  cues: TopicCue[],
): FoundIdea[] {
  const discovered = discoverConfirmedCues(cues);
  const existingEvidence = [...established, ...discovered].map(
    ({ evidence }) => new Set(evidence.map(({ id }) => id)),
  );
  const selected: { scope: string; anchors: string[]; threads: Set<string> }[] = [];
  for (const [key, group] of groupQuestions(signals.map(signal))) {
    const ids = new Set(group.map(({ record }) => record.id));
    if (existingEvidence.some((existing) => overlap(existing, ids) >= Math.ceil(ids.size * 0.75)))
      continue;
    const [platform, intent, ...anchors] = key.split(':');
    const scope = `${platform}:${intent}`;
    const threads = new Set(group.map(({ thread }) => thread));
    if (
      selected.some(
        (topic) =>
          topic.scope === scope &&
          topic.anchors.some((anchor) => anchors.includes(anchor)) &&
          overlap(topic.threads, threads) >= Math.ceil(threads.size * 0.75),
      )
    )
      continue;
    const draft = group
      .filter(({ role }) => role === 'question')
      .sort((a, b) => a.text.length - b.text.length)
      .map((question) => outline(question, anchors))
      .find(Boolean);
    if (!draft) continue;
    discovered.push(discoveredIdea(key, draft, group));
    existingEvidence.push(ids);
    selected.push({ scope, anchors, threads });
  }
  return discovered;
}
