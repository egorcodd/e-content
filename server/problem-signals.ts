export type AudienceRole = 'question' | 'complaint';

export function isConcreteComplaint(text: string) {
  return /(?:^| )(?:ничего не помогает|без результата|не (?:работает|срабатывает|запускается|открывается|сохраняется|приходит|приходят|отвечают|получается|удается)|отказ за отказом|(?:0|ноль) (?:ответов|откликов))(?: |$)/u.test(
    text,
  );
}

const applications = /отклик|резюм|ваканси|сопроводительн/;
const interviewQuestion =
  /(?:как|почему|что делать).{0,36}(?:(?:попаст[ь]|выйти|дойти|позват[ь]|приглашают|приглашается|приглашени[ея]|получит[ь]|добиться|нет).{0,32}(?:собес|интервью)|(?:отклики?|на отклики).{0,30}(?:не отвеч|без ответа|ответа нет))/;
const silence =
  /(?:^| )(?:0|ноль) (?:фидб[эе]к|ответ|приглаш)|ответов? нет|нет ответов?|без ответа|никто не отвеч|не отвечают|не (?:зовут|приглашают) на собес/;
const manyApplications =
  /(?:^| )(?:[1-9]\d{1,}|много|кучу|тучу|массу|десятки|сотни|тысяч[аиу]) (?:\p{L}+ ){0,2}отклик/u;
const fewInterviews =
  /(?:^| )(?:0|ноль|ни одного|только (?:[12]|один|два)|всего (?:[12]|один|два)) собес/;

function interviewResponse(text: string): AudienceRole | undefined {
  if (interviewQuestion.test(text)) return 'question';
  if (
    applications.test(text) &&
    (silence.test(text) || (manyApplications.test(text) && fewInterviews.test(text)))
  )
    return 'complaint';
}

function entryWithAi(text: string): AudienceRole | undefined {
  const technology = /(?:^| )(?:ии|ai)(?: |$)|нейросет/;
  const jobs = /работ|разработ|программист|кодер|ваканси|айти|джун/;
  const entry = /уч[уыи]|школ|класс|начина|джун|нович|войти|зайти/;
  const risk = /замен[яи]|вытесн|отбира[ею]|забира[ею]|отним[ае]/;
  if (![technology, jobs, entry, risk].every((pattern) => pattern.test(text))) return;
  if (/думаешь так будет|стоит ли|как (?:начать|подготовиться|выбрать)|дай совет/.test(text))
    return 'question';
  if (/пугает|боюсь|хз где|не знаю где|не уверен|как верить|не могу найти/.test(text))
    return 'complaint';
}

const problems = [
  {
    key: 'application-response',
    classify: interviewResponse,
    title: 'Как получить собеседование, если на отклики не отвечают',
    plan: 'Разобрать, где теряются отклики. На примерах одной вакансии и резюме показать, как проверить соответствие требованиям и измерить результат изменений.',
  },
  {
    key: 'starting-a-programming-career-with-ai',
    classify: entryWithAi,
    title: 'Стоит ли учиться программированию, если ИИ меняет рынок',
    plan: 'На примерах вакансий для начинающих показать, какие задачи меняются и какие навыки можно начать проверять на учебных проектах уже сейчас.',
  },
];

export function recurringProblem(text: string) {
  for (const { key, classify, title, plan } of problems) {
    const role = classify(text);
    if (role) return { key, title, body: `# ${title}\n\n${plan}`, role };
  }
}
