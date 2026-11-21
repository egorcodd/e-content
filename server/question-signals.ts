export function questionParts(text: string) {
  const parts: string[] = [];
  for (const sentence of text.match(/[^.!?\n]+[?!]?/g) ?? []) {
    const part = sentence.trim();
    const previous = parts.at(-1);
    if (previous?.includes('?') && /^(?:или|либо|or)(?:\s|$)/iu.test(part))
      parts[parts.length - 1] = `${previous} ${part}`;
    else if (part) parts.push(part);
  }
  return parts;
}

export function isShortQuestion(text: string) {
  return /(?:^| )(?:или|либо|or|нормально|норм|востребован[а-я]*|стоит|успе[юет][а-я]*|есть смысл)(?: |$)/u.test(
    text,
  );
}

// A concrete request about the work can be phrased as a first-person statement.
export function asksAboutRoleTasks(words: string) {
  return /(?:^| )(?:хочу (?:пойти |уйти )?в|хочу стать|планирую стать) \S+(?: \S+){0,4} (?:но )?(?:хз|не знаю|не понимаю) (?:что|чо|чем|какие задачи) (?:он[аи]? |там |они )?(?:дела|занима|реша)/u.test(words);
}

const tracks = [
  {
    key: 'backend',
    names: /(^| )(?:б[еэ]к[еэ]нд|back ?end)(?:а|у|е|ом)?(?= |$)/gu,
    title: 'Кому подойдёт бэкенд на старте',
    plan: 'Показать на одном проекте, за что отвечает бэкенд-разработчик, чем его работа отличается от фулстека и какую первую задачу можно попробовать в каждой роли.',
  },
  {
    key: 'fullstack',
    names: /(^| )(?:фулл? ?ст[еэ]к|full ?stack)(?:а|у|е|ом)?(?= |$)/gu,
    title: 'Кому подойдёт фулстек на старте',
    plan: 'Показать на одном проекте, где фулстек-разработчик работает с интерфейсом и сервером, и какие навыки понадобятся для первой задачи.',
  },
];

const roleNames = '(?:backend|fullstack)';
const shortEvaluation = new RegExp(
  `^${roleNames} (?:норм(?:ально)?|подойдет|хорошее направление)$`,
);
const bareAlternatives = new RegExp(`^${roleNames} (?:или|либо|or) ${roleNames}$`);
const careerQuestion =
  /(?:идти|пойти|войти) в (?:backend|fullstack)|(?:стать|работать) (?:backend|fullstack)|(?:backend|fullstack) разраб[а-я]* (?:стать|быть)|выбрать (?:backend|fullstack)/;

function draft(key: string, title: string, plan: string, contextual = false) {
  return { key, title, body: `# ${title}\n\n${plan}`, contextual };
}

export function trackQuestions(words: string) {
  let canonical = words.replace(/^(?:(?:а|бро|братан|ребята|слушай|подскажи|подскажите) )+/u, '');
  for (const { key, names } of tracks) canonical = canonical.replace(names, `$1${key}`);
  if (!(
    shortEvaluation.test(canonical) ||
    bareAlternatives.test(canonical) ||
    careerQuestion.test(canonical)
  ))
    return [];
  return tracks
    .filter(({ key }) => canonical.split(' ').includes(key))
    .map(({ key, title, plan }) => draft(`career-choice:${key}`, title, plan));
}

const school = /школ[ауеыь]|школьник|(?:^| )(?:[5-9]|1[01]) класс|(?:^| )(?:мне|в) 1[2-7](?: |$)/;
const it = /(?:^| )айти(?: |$)|(?:^| )(?:в|для) it(?: |$)|программирован|программист|разработчик/;
const timing =
  /успею|не рано ли|не поздно ли|слишком (?:рано|поздно)|(?:когда|с какого возраста) начат|стоит (?:ли )?(?:начать )?учит/;

export function isItContext(words: string) {
  return it.test(words);
}

export function schoolTimingQuestion(words: string, hasQuestion: boolean) {
  if (
    !school.test(words) ||
    !timing.test(words) ||
    (!hasQuestion && !/успею (?:ли )?зайти/.test(words))
  )
    return;
  return draft(
    'school-it-timing',
    'Когда школьнику начинать готовиться к карьере в IT',
    'Разобрать, что можно попробовать ещё в школе, какие шаги оставить на потом и как на небольшом проекте понять, интересно ли писать код.',
    !isItContext(words),
  );
}
