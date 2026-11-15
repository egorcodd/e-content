import type { Material } from './repository';
import { formatFolder, type IdeaFormat, type IdeaStatus, type IdeaPriority } from './idea-model';

export function sampleIdeas(): Material[] {
  const topics: [
    string,
    IdeaFormat,
    IdeaStatus,
    IdeaPriority,
    boolean,
    number,
    number,
    string[],
  ][] = [
    [
      'Почему автотесты падают только на CI',
      'video',
      'selected',
      'high',
      true,
      0,
      12,
      [
        'Локально тест зелёный, а в CI падает. Где искать причину?',
        'Как отличить flaky-тест от настоящего бага?',
        'Нужно ли повторять упавшие тесты автоматически?',
      ],
    ],
    [
      'Как написать баг-репорт, который не вернут',
      'post',
      'new',
      'normal',
      false,
      0,
      8,
      [
        'Что обязательно прикладывать к баг-репорту?',
        'Разработчик не может повторить баг. Как описать окружение?',
        'Нужны ли логи, если уже есть видео ошибки?',
      ],
    ],
    [
      'Что спрашивают у Junior QA на собеседовании',
      'video',
      'in-progress',
      'high',
      true,
      1,
      9,
      [
        'Какие вопросы задать самому на собеседовании?',
        'Как отвечать про опыт, если опыта нет?',
        'Нужно ли учить SQL до первого собеседования?',
      ],
    ],
    [
      'Почему 100% покрытия не гарантируют качество',
      'post',
      'selected',
      'normal',
      true,
      2,
      4,
      [
        'Покрытие кода и качество тестирования — разные показатели.',
        'Команда закрыла метрику покрытия, но пропустила ошибку в сценарии.',
        'Как оценивать полезность проверок?',
      ],
    ],
    [
      'Как читать логи и находить причину ошибки',
      'video',
      'new',
      'normal',
      false,
      2,
      5,
      [
        'С чего начать, если в логах тысяча строк?',
        'Какие сообщения прикладывать к дефекту?',
        'Как найти запрос по trace ID?',
      ],
    ],
    [
      'Чек-лист проверки API перед релизом',
      'post',
      'published',
      'low',
      true,
      3,
      7,
      [
        'Какие проверки нужны кроме статуса 200?',
        'Как тестировать ошибки авторизации?',
        'Нужно ли проверять повтор запроса?',
      ],
    ],
    [
      'Когда ручные проверки полезнее автоматизации',
      'video',
      'new',
      'normal',
      false,
      4,
      3,
      [
        'Нужно ли автоматизировать всё?',
        'Как выбрать первые сценарии для автотестов?',
        'Что делать, если интерфейс меняется каждый день?',
      ],
    ],
    [
      'Как оценить тестовое задание перед откликом',
      'video',
      'archived',
      'low',
      false,
      6,
      2,
      [
        'Стоит ли браться за задание на несколько дней?',
        'Как понять критерии оценки тестового задания?',
      ],
    ],
    [
      'Проверки мобильной формы без большого чек-листа',
      'post',
      'selected',
      'normal',
      true,
      8,
      6,
      [
        'Как проверять ввод с экранной клавиатуры?',
        'Что будет с формой при смене ориентации экрана?',
        'Как тестировать потерю сети во время отправки?',
      ],
    ],
    [
      'Как аргументировать критичность бага',
      'video',
      'new',
      'normal',
      false,
      10,
      4,
      [
        'Чем приоритет отличается от серьёзности?',
        'Как объяснить, что дефект блокирует пользователя?',
        'Кто решает, можно ли выпускать релиз с ошибкой?',
      ],
    ],
    [
      'Разобрать вопросы про старт в тестировании',
      'undecided',
      'new',
      'low',
      false,
      12,
      1,
      ['С чего начать, если не понимаю разницу между QA и тестированием?'],
    ],
    [
      'Как команды разбирают пропущенные дефекты',
      'post',
      'new',
      'normal',
      false,
      15,
      3,
      [
        'Разбор инцидента помогает изменить процесс проверки.',
        'Команды обсуждают дефекты без поиска виноватого.',
        'Какие действия снижают повторение ошибок?',
      ],
    ],
  ];
  return topics.map(
    ([title, format, status, priority, favorite, days, mentions, quotes], index) => {
      const date = new Date();
      date.setDate(date.getDate() - days);
      date.setHours(11, index * 3, 0, 0);
      const createdAt = date.toISOString();
      const source = format === 'video' ? ('tiktok' as const) : ('telegram' as const);
      const fromPosts = index === 3 || index === 11;
      return {
        id: `sample-idea-${index + 1}`,
        origin: 'sample',
        title,
        format,
        status,
        priority,
        favorite,
        folderId: status === 'archived' ? 'archive' : formatFolder(format),
        ...(status === 'archived'
          ? { archivedFrom: formatFolder(format), statusBeforeArchive: 'new' as const }
          : {}),
        source,
        revision: 1,
        createdAt,
        updatedAt: createdAt,
        body: `${quotes[0]}\n\nТема для ${format === 'video' ? 'короткого разбора в видео' : format === 'post' ? 'публикации в Telegram' : 'дальнейшего отбора'}. В основе — ${fromPosts ? 'наблюдения из публикаций каналов' : 'повторяющиеся вопросы аудитории'}.\n\nАкцент: ${quotes[1] ?? 'трудности на старте в профессии.'}`,
        evidence: Array.from({ length: mentions }, (_, item) => ({
          id: `sample-${index + 1}-${item + 1}`,
          source: index === 0 && item > 7 ? ('telegram' as const) : source,
          kind: fromPosts ? ('post' as const) : ('comment' as const),
          text: quotes[item % quotes.length],
          publicationId: `sample-publication-${index}-${Math.floor(item / 4)}`,
          publishedAt: new Date(Date.parse(createdAt) - (item % 7) * 86400000).toISOString(),
        })),
      };
    },
  );
}
