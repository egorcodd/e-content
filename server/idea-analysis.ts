import type { CollectedRecord, FoundIdea } from '../src/features/collection/contracts.ts';

import { ideaDraft, type IdeaTopic } from '../src/features/collection/idea-drafts.ts';
import {
  discoverTopics,
  evidenceFor,
  type AudienceSignal,
  type TopicCue,
} from './discover-topics.ts';
import { isConcreteComplaint, recurringProblem } from './problem-signals.ts';
import {
  asksAboutRoleTasks,
  isItContext,
  isShortQuestion,
  questionParts,
  schoolTimingQuestion,
  trackQuestions,
} from './question-signals.ts';

type Topic = {
  id: IdeaTopic;
  subject: RegExp;
  need: RegExp;
};

const starting =
  /начат|старт|перв[а-я]* (шаг|язык|курс)|войти|перейти|вход|учит|учеб|изуч|осво|нович|без опыта|направлен|посовет|выбрать/;
const topics: Topic[] = [
  {
    id: 'cybersecurity-start',
    subject: /кибер\s*(?:без|безопас)|информационн[а-я]* безопас|\bcybersecurity\b/,
    need: /начат|старт|войти|перейти|пайтон учит|посовет|что учить/,
  },
  {
    id: 'devops-start',
    subject: /девопс|\bdevops\b/,
    need: /начат|войти|перейти|стать|учит|изуч|без опыта|нович|стоит|смогу|что думаешь/,
  },
  {
    id: 'test-ci',
    subject: /автотест|тест[а-я]* /,
    need: /\bci\b|ci\/cd|пайплайн|нестабил|флак|flak|пада|фейл/,
  },
  {
    id: 'api-testing',
    subject: /\bapi\b|апи/,
    need: /провер|тест|контракт|валидац/,
  },
  {
    id: 'qa-start',
    subject: /тестиров|\bqa\b/,
    need: starting,
  },
  {
    id: 'first-language',
    subject: /язык|питон|пайтон|\bpython\b|джав|\bjava(?:script)?\b|си шарп|\bc#/,
    need: /нача[лть]|перв[а-я]* язык|перв[а-я]* учит|старт|с какого|какой язык/,
  },
  {
    id: 'school-it-direction',
    subject: /направлен|специальност|професси|поступа|поступи|на кого|\bегэ\b/,
    need: /не знаю|как выбрать|куда идти|куда поступ|на какую|на какое|на кого|какие направления/,
  },
  {
    id: 'math',
    subject: /математик|алгебр/,
    need: /нужн|важн|обязательн|проблем|сложн|плохо|подтян|меша/,
  },
  {
    id: 'freelance',
    subject: /фриланс|клиент|заказчик|покупател|заказ[ыа]/,
    need: /найти|искать|поиск|нет клиент|без клиент|получить|заработать|привлечь/,
  },
  {
    id: 'portfolio',
    subject: /портфолио|пет[ -]?проект|pet[ -]?project|учебн[а-я]* проект/,
    need: /сделат|показат|положит|выбрат|оцен|нужн|достаточ|добав|улучш/,
  },
  {
    id: 'interview',
    subject: /собес|интервью|тестов[а-я]* задани/,
    need: /как подготов|что (?:спрашив|отвечать|решать)|какие (?:вопрос|задач)|как (?:ответить|решать)|не прош[её]л.*(?:задач|вопрос)/,
  },
  {
    id: 'first-job',
    subject: /работ[ауе]|трудоустр|ваканси|джун|\bjunior\b|стажиров|резюме|собес/,
    need: /без (?:коммерческого )?опыта|перв[а-я]* работ|перв[а-я]* мест|нет опыта|как найти стажиров|куда (?:можно )?(?:пойти |устроиться )?на стажиров|на джуна.*не берут/,
  },
];

const directQuestion =
  /^(?:(?:а|бро|братан|родной|радной|ребята|привет|слушай) )*(?:как|где|куда|почему|какой|какая|какое|какую|какие|какого|стоит|с чего|с какого|насколько|что (?:делать|думаешь|учить|выбрать|посоветуешь|нужно|лучше|подойдет|насчет)|ч[ео] делать|how|why|which|what|where)(?: |$)/;
const askForHelp =
  /(?:^| )(?:подскаж[а-я]*|посовет[а-я]*|дай совет|расскажи[а-я]*|объясни[а-я]*)(?: |$)/;
const decisionQuestion =
  /(?:^| )(?:стоит ли|норм|смогу|с чего начать|чему учиться|учить|войти|что (?:стоит|лучше|нужно) (?:изучить|учить|освоить))(?: |$)/;
const obstacle =
  /(?:^| )(?:не понимаю|не получается|не могу (?:выбрать|найти|понять|решить|устроиться)|не знаю|у меня (?:нет|проблем[а-я]*)|нет (?:клиент|заказ|опыт))/;
const chatter =
  /^(?:ты ч[ео]|а ты |х[аэ]х[аэ]х|это где такие сказки|конкурентов убираешь|во во |ты в курсе|а зачем еще|почему бред)|(?:ты|тебя|тебе) (?:[а-я]+ ){0,3}(?:дурак|дурачок|долбо[её]б|идиот|поц)(?: |$)/;

function normalize(text: string) {
  return text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();
}

function* questionsFrom(record: CollectedRecord, text: string) {
  const sentences = questionParts(text);
  for (const [index, sentence] of sentences.entries()) {
    const words = normalize(sentence);
    if (words.split(' ').filter((word) => word.length >= 2).length < 2) continue;
    const isQuestion =
      directQuestion.test(words) ||
      askForHelp.test(words) ||
      asksAboutRoleTasks(words) ||
      (sentence.includes('?') && (decisionQuestion.test(words) || isShortQuestion(words)));
    const role = isQuestion
      ? ('question' as const)
      : isConcreteComplaint(words)
        ? ('complaint' as const)
        : undefined;
    if (record.kind === 'comment' && !role && !obstacle.test(words)) continue;
    const previous = sentences[index - 1];
    const context =
      previous?.endsWith('?') && /^с чего начать(?: |$)/.test(words) ? normalize(previous) : '';
    yield { text: sentence.trim().replace(/\s+/g, ' '), words, context, role };
  }
}

function isNearCopy(words: Set<string>, previous: Set<string>) {
  let overlap = 0;
  for (const word of words) if (previous.has(word)) overlap++;
  return overlap / (words.size + previous.size - overlap) >= 0.85;
}

export function analyzeIdeas(records: Iterable<CollectedRecord>): FoundIdea[] {
  const parentById = new Map<string, string>();
  const itPublications = new Set<string>();
  const matches = [];
  for (const record of records) {
    if (record.parentId) parentById.set(record.id, record.parentId);
    if (record.kind === 'post' && isItContext(normalize(record.text)))
      itPublications.add(record.publicationId);
    if (record.kind === 'post' && record.purpose !== 'inspiration') continue;
    const text = record.text.normalize('NFKC').replace(/https?:\/\/\S+|@[^\s]+/g, ' ');
    const words = normalize(text);
    if (chatter.test(words)) continue;
    const clauses = [...questionsFrom(record, text)];
    const problem = record.kind === 'comment' ? recurringProblem(words) : undefined;
    const timing =
      record.kind === 'comment' ? schoolTimingQuestion(words, text.includes('?')) : undefined;
    if (clauses.length || problem || timing)
      matches.push({ record, clauses, problem, timing, text });
  }
  const groups = new Map<
    string,
    { idea: FoundIdea; fingerprints: Set<string>[]; threads: Set<string> }
  >();
  const signals: AudienceSignal[] = [];
  const cues: TopicCue[] = [];
  for (const { record, clauses, problem, timing, text } of matches) {
    let thread = record.id;
    const seen = new Set<string>();
    for (
      let parent = parentById.get(thread);
      parent && !seen.has(parent);
      parent = parentById.get(thread)
    ) {
      seen.add(thread);
      thread = parent;
    }
    if (record.kind === 'comment') {
      for (const clause of clauses) {
        if (clause.role) signals.push({ record, thread, text: clause.text, role: clause.role });
        if (clause.role === 'question') {
          for (const draft of trackQuestions(clause.words))
            cues.push({
              ...draft,
              record,
              thread,
              text,
              role: 'question',
              confirmation: 'question-pair',
            });
        }
      }
      if (timing && (!timing.contextual || itPublications.has(record.publicationId)))
        cues.push({
          ...timing,
          record,
          thread,
          text,
          role: 'question',
          confirmation: 'question-pair',
        });
      if (
        problem &&
        (problem.role === 'complaint' || clauses.some(({ role }) => role === 'question'))
      )
        cues.push({ ...problem, record, thread, text, confirmation: 'question-with-complaint' });
    }

    const match = clauses.flatMap(({ words, context, role }) => {
      if (role === 'complaint' && !obstacle.test(words)) return [];
      const topic = topics.find(
        ({ id, subject, need }) =>
          (subject.test(words) || subject.test(context)) &&
          (need.test(words) ||
            (['devops-start', 'qa-start', 'cybersecurity-start'].includes(id) &&
              asksAboutRoleTasks(words))),
      );
      return topic ? [{ topic, words }] : [];
    })[0];
    if (!match) continue;
    const { topic } = match;
    const words = new Set(match.words.split(' ').filter((word) => word.length >= 2));
    const id = `${record.platform}-topic-${topic.id}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        fingerprints: [],
        threads: new Set(),
        idea: {
          id,
          ...ideaDraft(topic.id)!,
          format: record.platform === 'tiktok' ? 'video' : 'undecided',
          source: record.platform,
          evidence: [],
        },
      };
      groups.set(id, group);
    }
    if (
      group.fingerprints.length >= 100 ||
      group.threads.has(thread) ||
      group.fingerprints.some((other) => isNearCopy(words, other))
    )
      continue;
    group.fingerprints.push(words);
    group.threads.add(thread);
    group.idea.evidence.push(evidenceFor(record));
  }
  const established = [...groups.values()]
    .map(({ idea }) => idea)
    .filter(({ evidence }) => evidence.length >= 2);
  return [...established, ...discoverTopics(signals, established, cues)].sort(
    (a, b) => b.evidence.length - a.evidence.length || a.id.localeCompare(b.id),
  );
}
