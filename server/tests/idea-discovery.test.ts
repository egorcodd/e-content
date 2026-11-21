import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollectedRecord } from '../../src/features/collection/contracts.ts';
import { analyzeIdeas } from '../idea-analysis.ts';

function comment(id: string, text: string, parentId?: string): CollectedRecord {
  return {
    id,
    platform: 'tiktok',
    kind: 'comment',
    text,
    parentId,
    sourceId: 'profile',
    publicationId: 'first-video',
    videoId: 'first-video',
    purpose: 'own',
    publishedAt: null,
    url: 'https://www.tiktok.com/@example/video/7000000000000000000?comment_id=' + id,
  };
}

test('an implicit request about DevOps tasks supports entry questions across threads', () => {
  const q = comment('a', 'Стоит ли идти в девопс?');
  const interest = comment('b', 'хочу в devops но хз чо он делает');
  const chatter = comment('c', 'хочу в DevOps, сегодня поднял сервер');
  assert.deepEqual(analyzeIdeas([q, interest, chatter])[0].evidence.map(e => e.id), ['a', 'b']);
  assert.deepEqual(analyzeIdeas([q, { ...interest, parentId: 'a' }]), []);
});

test('a general interview request cannot corroborate a question about a first internship', () => {
  const first = comment('a', 'куда можно на стажировку устроиться го бекендером?');
  const general = comment('b', 'А как попасть на собес, я уже переделал резюме?');
  assert.deepEqual(analyzeIdeas([first, general]), []);
  const similar = comment('c', 'Как найти стажировку без опыта работы?');
  assert.equal(analyzeIdeas([first, similar])[0].id, 'tiktok-topic-first-job');
});

test('independent questions discover a topic outside the catalog and retain linked evidence', () => {
  const a = comment('a', 'Как подобрать помол для эспрессо?');
  const b = comment('b', 'Как настроить помол под эспрессо дома?');
  const records = [
    a,
    comment('duplicate', a.text + '!'),
    comment('reply', 'Как менять помол для эспрессо под новую кофемолку?', 'a'),
    comment('reply-to-reply', 'Как выбрать помол эспрессо для другой корзины?', 'reply'),
    b,
    comment('separate-need', 'Почему помол для эспрессо забивает кофемолку?'),
    comment('singleton', 'Как измерить давление в гидропонике?'),
    comment('off-topic', 'Ты идиот, как подобрать помол для эспрессо?'),
  ];
  const ideas = analyzeIdeas(records);
  assert.equal(ideas.length, 1);
  assert.match(ideas[0].id, /^tiktok-discovered-[a-f0-9]{24}$/);
  assert.match(ideas[0].title, /помол.*эспрессо/i);
  assert.notEqual(ideas[0].title, a.text.replace(/\?$/, ''));
  assert.ok(!ideas[0].body.includes(a.text));
  assert.deepEqual(
    ideas[0].evidence.map(({ id, url }) => [id, url]),
    [
      [a.id, a.url],
      [b.id, b.url],
    ],
  );
  assert.equal(analyzeIdeas([a, b]).at(0)?.id, ideas[0].id);
});

test('rephrasing a question within the same branch never creates an idea by itself', () => {
  const root = comment('a', 'Как подобрать помол для эспрессо?');
  const reply = comment('b', 'Как настроить помол под эспрессо дома?', root.id);
  const nested = comment('c', 'Как менять помол для эспрессо под новую кофемолку?', reply.id);
  assert.deepEqual(analyzeIdeas([nested, reply, root]), []);
});

test('new topics use a shared subject in the title when the question cannot be directly rewritten', () => {
  const first = comment('a', 'Какая бумага подходит для акварели?');
  const second = comment('b', 'Какую бумагу лучше взять для акварели новичку?');
  const [idea] = analyzeIdeas([first, second]);
  assert.match(idea.title, /бумага для акварели/i);
  assert.equal(idea.evidence.length, 2);
  assert.doesNotMatch(idea.body, /Какая бумага подходит/);
});

test('reports of unanswered applications support an interview question across independent branches', () => {
  const question = comment('a', 'А как попасть на собес, уже переделываю резюме и портфолио?');
  const reports = [
    comment('b', 'Три года опыта, 500 откликов, 0 собесов.'),
    comment('c', 'Отправил кучу откликов Java разработчиком, в итоге только один собес.'),
    comment('d', 'Под каждую вакансию создаю резюме индивидуально. 0 фидбэка.'),
  ];
  const ideas = analyzeIdeas([
    ...reports,
    question,
    comment('e', '3000 откликов, всего два собеса.', 'b'),
    comment('f', 'Отправил пять откликов и прошёл один собес.'),
    comment('g', 'Как подготовиться к техническому собеседованию?'),
    comment('h', 'Резюме не сохраняется после обновления сайта.'),
  ]);
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].title, 'Как получить собеседование, если на отклики не отвечают');
  assert.deepEqual(new Set(ideas[0].evidence.map(({ id }) => id)), new Set(['a', 'b', 'c', 'd']));
  for (const record of [question, ...reports]) assert.ok(!ideas[0].body.includes(record.text));
  assert.deepEqual(analyzeIdeas(reports), []);
  assert.deepEqual(analyzeIdeas([question, { ...reports[0], parentId: question.id }]), []);
  const followup = comment(
    'followup',
    'Как попасть на собеседование с большим числом откликов?',
    reports[0].id,
  );
  const [fromTwoThreads] = analyzeIdeas([followup, question, reports[0]]);
  assert.deepEqual(
    fromTwoThreads.evidence.map(({ id }) => id),
    [question.id, reports[0].id],
  );
});

test('a concrete complaint can support a matching question outside predefined topics', () => {
  const question = comment('a', 'Почему проектор теряет картинку после подключения HDMI?');
  const report = comment(
    'b',
    'После подключения HDMI проектор снова теряет картинку, ничего не помогает.',
  );
  const other = comment('c', 'После подключения HDMI на проекторе не работает звук.');
  const opinion = comment('d', 'Проектор с HDMI не нужен, мне он не нравится.');
  const [idea, ...extra] = analyzeIdeas([question, report, other, opinion]);
  assert.equal(extra.length, 0);
  assert.deepEqual(
    idea.evidence.map(({ id }) => id),
    [question.id, report.id],
  );
  assert.match(idea.title, /проектор теряет картинку/i);
  assert.ok(!idea.body.includes(report.text));
});

test('a concern about learning links to a separate report about AI and entry-level jobs', () => {
  const question = comment(
    'a',
    'Стоит ли учиться программированию, если ИИ может заменить разработчиков?',
  );
  const report = comment(
    'b',
    'Учу C++, хз где искать работу. ИИ отбирает работу, вакансий для джунов ноль.',
  );
  const debates = [
    comment('c', 'ИИ заменит программистов, а джунов и так много.'),
    comment('d', 'Я боюсь тратиться на подписку, пока только учу программирование.'),
  ];
  const [idea, ...rest] = analyzeIdeas([question, ...debates, report]);
  assert.equal(rest.length, 0);
  assert.equal(idea.title, 'Стоит ли учиться программированию, если ИИ меняет рынок');
  assert.deepEqual(
    idea.evidence.map(({ id }) => id),
    [question.id, report.id],
  );
});

test('short evaluations and comparisons support the shared career choice across spellings', () => {
  const short = comment('a', 'Братан бэкенд норм?');
  const comparison = comment('b', 'full stack норм? или все таки backend разрабом стать');
  const advice = comment('c', 'Да иди в бек, зачем упарываться для фулл стека', comparison.id);
  const technical = comment('d', 'Сервер бэкенда не запускается после деплоя.');
  const unrelated = comment('e', 'Стоит ли включать кэш на бэкенде?');
  const [idea, ...rest] = analyzeIdeas([short, comparison, advice, technical, unrelated]);
  assert.equal(rest.length, 0);
  assert.equal(idea.title, 'Кому подойдёт бэкенд на старте');
  assert.deepEqual(
    idea.evidence.map(({ id }) => id),
    [short.id, comparison.id],
  );
  assert.doesNotMatch(idea.body, /Братан|разрабом стать/);
  assert.deepEqual(analyzeIdeas([comparison, { ...short, parentId: comparison.id }]), []);
  const compact = comment('short', 'Бэкенд норм?');
  const withDash = comment('with-dash', 'Full-stack норм? Или стать backend-разрабом?');
  assert.equal(analyzeIdeas([compact, withDash]).at(0)?.id, idea.id);
});

test('a second option after a question mark is retained for comparisons outside IT', () => {
  const first = comment('a', 'Зеркалка норм? Или всё-таки беззеркалка для съёмки?');
  const second = comment('b', 'Какую зеркалку или беззеркалку выбрать?');
  const [idea, ...rest] = analyzeIdeas([first, second]);
  assert.equal(rest.length, 0);
  assert.match(idea.title, /зеркалку или беззеркалку/i);
  assert.deepEqual(
    idea.evidence.map(({ id }) => id),
    [first.id, second.id],
  );
});

test('a short question about age can use a relevant publication and a precise question as context', () => {
  const short = comment('a', 'а если мне 13 стоит учиться? и если да на кого именно и что');
  const timing = comment('b', 'закончу школу только через два года я успею зайти в айти');
  const unrelated = comment('c', 'даже в 45?');
  const post: CollectedRecord = {
    ...comment('first-video', 'Помогаю попасть в айти'),
    kind: 'post',
  };
  const [idea, ...rest] = analyzeIdeas([short, timing, unrelated, post]);
  assert.equal(rest.length, 0);
  assert.equal(idea.title, 'Когда школьнику начинать готовиться к карьере в IT');
  assert.deepEqual(
    idea.evidence.map(({ id }) => id),
    [timing.id, short.id],
  );
  assert.doesNotMatch(idea.body, /мне 13|успею зайти/);
  assert.deepEqual(analyzeIdeas([short, timing, { ...post, text: 'Мой обычный день' }]), []);
  assert.deepEqual(analyzeIdeas([short, { ...timing, publicationId: 'other-video' }, post]), []);
  assert.deepEqual(analyzeIdeas([short, { ...timing, parentId: short.id }, post]), []);
});
