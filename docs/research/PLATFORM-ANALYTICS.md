# Telegram и TikTok: возможности аналитики для e-content

Проверено: **15 ноября 2026 года**. Исследование официальной документации; API и аккаунты не подключались. Подтверждённые возможности ниже отделены от предложений по реализации.

## Основные выводы

- **Telegram:** подробная статистика канала доступна через пользовательскую сессию MTProto при наличии права `can_view_stats`. Один Bot API такую аналитику не заменяет. [Channel statistics](https://core.telegram.org/api/stats), [getBroadcastStats](https://core.telegram.org/method/stats.getBroadcastStats).
- **TikTok Display API:** профиль и текущие счётчики собственных публичных видео. История изменения счётчиков требует собственного накопления. [Display API](https://developers.tiktok.com/docs/en/display-api-overview), [Video Object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object).
- **TikTok Accounts API / Organic API for Business:** существует полноценная аналитика аккаунта по дням и расширенная аналитика роликов, включая удержание. Её нельзя объявлять недоступной на основании ограничений Display API. Доступ зависит от одобрения приложения, разрешений пользователя, типа аккаунта и наличия конкретной метрики в TikTok Analytics. [Accounts API](https://business-api.tiktok.com/portal/docs/accounts-api/v1.3), [профиль](https://business-api.tiktok.com/portal/docs/get-profile-data-of-a-tiktok-account/v1.3), [ролики](https://business-api.tiktok.com/portal/docs/get-post-data-of-a-tiktok-account/v1.3).
- **Research API не подходит как обход для коммерческого e-content:** TikTok прямо исключает создателей контента, рекламодателей и коммерческих пользователей из программы. [Research FAQ](https://developers.tiktok.com/docs/en/research-api-faq).

## 1. Telegram

### Доступ и границы

Подробная статистика зависит от серверной конфигурации Telegram: не следует зашивать универсальный минимальный размер канала. Источник истины — `channelFull.can_view_stats`. Запросы статистики направляются в `stats_dc`. Методы `stats.getBroadcastStats` и `stats.getMessageStats` доступны пользовательским аккаунтам, не ботам. [Channel statistics](https://core.telegram.org/api/stats), [getBroadcastStats](https://core.telegram.org/method/stats.getBroadcastStats), [getMessageStats](https://core.telegram.org/method/stats.getMessageStats).

Владелец/администратор своего канала и читатель чужого канала имеют разные возможности. Доступность публичных сообщений чужого канала не предоставляет административную статистику. В реализации проверять права, а не только публичный адрес. [Channel statistics](https://core.telegram.org/api/stats), [channelFull](https://core.telegram.org/constructor/channelFull).

### Карта метрик

| Метрика                                          | Метод / поле                                                         | Доступ                             | Семантика и история                                          | Применение в интерфейсе            |
| ------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| Подписчики сейчас                                | Bot API `getChatMemberCount`                                         | Бот, доступ к чату                 | Текущий размер; историю сохраняем самостоятельно             | Компактный счётчик                 |
| Абсолютная аудитория и прирост                   | MTProto `stats.getBroadcastStats`: `growth_graph`, `followers_graph` | Пользователь, `can_view_stats`     | Абсолютный размер и относительные изменения соответственно   | Два режима графика аудитории       |
| Средние просмотры, пересылки, реакции            | `views_per_post`, `shares_per_post`, `reactions_per_post`            | То же                              | На публикацию за возвращённый период; `current` и `previous` | Карточки показателей со сравнением |
| Уведомления и отключения                         | `enabled_notifications`, `mute_graph`                                | То же                              | Доля включённых уведомлений и динамика отключений            | Качество аудитории                 |
| Откуда приходят просмотры / подписчики           | `views_by_source_graph`, `new_followers_by_source_graph`             | То же                              | Разные графики источников                                    | Источники охвата и роста           |
| Языки и эмоции                                   | `languages_graph`, `reactions_by_emotion_graph`                      | То же                              | Состав аудитории и распределение реакций                     | Небольшие диаграммы                |
| Просмотры и реакции конкретного поста во времени | `stats.getMessageStats`                                              | Пользователь, необходимые права    | Графики сообщения                                            | Углубление в выбранный материал    |
| Счётчики сообщения                               | `message.views`, `forwards`, `replies`, `reactions`                  | Доступ к сообщению                 | Текущие значения                                             | Основа сопоставления материалов    |
| Комментарии: число и тексты                      | `messageReplies.replies`; `messages.getReplies`                      | Доступ к каналу и ветке обсуждения | Счётчик отдельно от сообщений ветки                          | Анализ вопросов и тем              |

Источники таблицы: [Bot API: getChatMemberCount](https://core.telegram.org/bots/api#getchatmembercount), [broadcastStats](https://core.telegram.org/constructor/stats.broadcastStats), [messageStats](https://core.telegram.org/constructor/stats.messageStats), [message](https://core.telegram.org/constructor/message), [messageReplies](https://core.telegram.org/constructor/messageReplies), [getReplies](https://core.telegram.org/method/messages.getReplies).

`stats.getBroadcastStats` не принимает произвольные `start_date` / `end_date`: Telegram возвращает собственный `period`. Графики могут приходить асинхронно и загружаться через `stats.loadAsyncGraph`; возможен ответ с ошибкой графика. Это нужно учитывать в серверном адаптере и состоянии загрузки. [getBroadcastStats](https://core.telegram.org/method/stats.getBroadcastStats), [loadAsyncGraph](https://core.telegram.org/method/stats.loadAsyncGraph), [StatsGraph](https://core.telegram.org/type/StatsGraph).

`top_hours_graph` означает просмотры по часам, а не время выхода публикаций и не доказанное «лучшее время публикации». Возвращать удалённый пользователем блок «Время публикации» на этом основании не следует. В схеме также есть отдельные показатели и графики историй; они нужны только при фактическом использовании Stories. [broadcastStats](https://core.telegram.org/constructor/stats.broadcastStats).

### Что даёт Bot API

Бот получает сообщения каналов, участником которых является. Для группы обсуждения важны статус администратора и privacy mode: режим приватности ограничивает поступающие сообщения группы. Это отдельная задача от чтения самого канала. [Bots FAQ](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get).

Очередь входящих обновлений хранится не дольше 24 часов. Обновления `message_reaction_count` требуют администратора и явного включения в `allowed_updates`; они могут приходить с задержкой. Не следует воспринимать поток обновлений как восстановление всей старой истории реакций или комментариев. [Bot API: getting updates](https://core.telegram.org/bots/api#getting-updates), [Update](https://core.telegram.org/bots/api#update).

Для старых комментариев нужен доступ к соответствующей ветке: обсуждения канала связаны с группой, это не просто текстовое поле внутри статистики поста. [Threads](https://core.telegram.org/api/threads), [getDiscussionMessage](https://core.telegram.org/method/messages.getDiscussionMessage).

## 2. TikTok Display API

### Профиль, видео, разрешения

| Метрика / данные                                              | Endpoint                                                               | Scope / доступ                        | Семантика и история                                   | Применение                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------- | -------------------------------------- |
| Имя и аватар                                                  | `GET /v2/user/info/`                                                   | `user.info.basic`, OAuth владельца    | Профиль авторизованного пользователя                  | Подключённый аккаунт                   |
| Username, описание, ссылка, верификация                       | Тот же                                                                 | `user.info.profile`                   | Метаданные                                            | Идентификация источника                |
| Подписчики, подписки, полученные лайки, число публичных видео | Тот же                                                                 | `user.info.stats`                     | Текущие totals; не дневная статистика                 | Счётчики и собственная история снимков |
| Публичные видео владельца                                     | `POST /v2/video/list/`                                                 | `video.list`                          | По времени создания, пагинация; максимум 20 за запрос | Синхронизация материалов               |
| Обновление выбранных видео                                    | `POST /v2/video/query/`                                                | `video.list`, проверка принадлежности | До 20 ID                                              | Повторный сбор счётчиков               |
| Просмотры, лайки, комментарии, репосты                        | Поля видео: `view_count`, `like_count`, `comment_count`, `share_count` | Доступ к видео через указанные методы | Текущие счётчики каждого ролика                       | Сравнение показателей                  |

Источники таблицы: [Get User Info](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info), [List Videos](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list), [Query Videos](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query), [Video Object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object).

**Вывод для хранения:** курсор времени публикации в `video.list` не превращает ответ в историю просмотров. Для графика изменения счётчиков сохраняем регулярные снимки. Их разность отражает изменение между двумя сборами; это не восстановленные TikTok дневные просмотры за прошлый месяц. Удалённые/закрытые видео и пропущенные сборы требуют отдельной обработки. Основание: параметры [List Videos](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list) и определение счётчиков [Video Object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object).

В проверенном Display API нет полей удержания, среднего времени просмотра, уникального охвата и демографии. `comment_count` — число, не текст комментариев. Это ограничение именно данного продукта. [Display overview](https://developers.tiktok.com/docs/en/display-api-overview), [Video Object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object).

### Авторизация и эксплуатация

Для рабочего доступа нужны продукты и scopes приложения, согласие пользователя и одобрение TikTok. Текущие правила review исключают приложения исключительно для личного/частного использования и незавершённые приложения; требуют полноценный внешний сайт, Privacy Policy, Terms и демонстрацию интеграции. Локальный запуск сам по себе не означает, что производственный доступ одобрят. [App Review Guidelines](https://developers.tiktok.com/docs/en/app-review-guidelines).

Официальная страница управления OAuth, обновлённая 5 ноября 2026 года, указывает **2 часа для access token и 180 дней для refresh token**; refresh token ротируется. Это отличается от старых примеров с 24 часами/365 днями. При реализации источником истины должны быть `expires_in` и `refresh_expires_in` ответа; токены и client secret хранить на сервере. [Manage OAuth Access Tokens](https://developers.tiktok.com/docs/en/oauth-user-access-token-management).

Для каждого из `/v2/user/info/`, `/v2/video/list/`, `/v2/video/query/` указано стандартное ограничение 600 запросов за минутное скользящее окно; превышение даёт HTTP 429. Эти лимиты не переносим на Accounts API. [Rate Limits](https://developers.tiktok.com/docs/en/tiktok-api-v2-rate-limit).

## 3. TikTok Accounts API: расширенная аналитика

### Это отдельная интеграция

Accounts относится к Organic API for Business, а не к отчётам рекламного кабинета. Программа разрешает управление собственной органической представленностью брендов/авторов, включая insights и комментарии. Общие названия аккаунтов включают Personal, Advanced Access и Verified Business. Упоминание Personal не означает, что ему доступны все business-метрики. [Accounts overview](https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3).

С 20 марта 2026 года для нового приложения или расширения разрешений с TikTok Accounts нужна отдельная Access Application Form. Регистрация разработчика API for Business предусматривает организацию и корпоративный домен; текущая инструкция прямо говорит, что индивидуальных разработчиков не подключают. Это ограничение **участника программы**, не запрет персональных TikTok-аккаунтов у клиентов приложения. [Accounts API](https://business-api.tiktok.com/portal/docs/accounts-api/v1.3), [Register as developer](https://business-api.tiktok.com/portal/docs/register-as-a-developer/v1.3).

Авторизация: разрешение TikTok Accounts у приложения, затем согласие владельца. Accounts использует собственные `/tt_user/oauth2/token/`, `/tt_user/oauth2/refresh_token/`, заголовок `Access-Token` и `open_id` как `business_id`. Его документация по-прежнему указывает сутки/год; нельзя смешивать этот жизненный цикл с текущим OAuth Display. Проверять возвращённые сроки, а фактические scopes — через `/tt_user/token_info/get/`. [Authorization](https://business-api.tiktok.com/portal/docs/accounts-api-authorization/v1.3), [Authentication](https://business-api.tiktok.com/portal/docs/accounts-api-authentication/v1.3), [Token inspector](https://business-api.tiktok.com/portal/docs/get-the-authorized-tiktok-account-permission-scopes-via-access-token/v1.3).

### Подтверждённые данные

Все endpoints в таблице имеют префикс `https://business-api.tiktok.com/open_api/v1.3`.

| Метрика                                                           | Endpoint / поле                                                                                             | Scope и дополнительные условия                                   | Семантика / история                                                    | Применение                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------- |
| Дневные просмотры, посещения профиля, лайки, комментарии, репосты | `GET /business/get/`: `video_views`, `profile_views`, `likes`, `comments`, `shares`                         | `user.insights`; наличие в TikTok Analytics                      | Настоящие дневные значения, UTC, lookback 60 дней                      | Основной график активности |
| Прирост, пришедшие, ушедшие                                       | Тот же: `daily_total_followers`, `daily_new_followers`, `daily_lost_followers`                              | `user.insights`, Advanced Access / Verified Business             | `daily_total_followers` означает чистый прирост, а не размер аудитории | Приход / отток             |
| Уникальная охваченная / вовлечённая аудитория                     | Тот же: `unique_video_views`, `engaged_audience`                                                            | То же                                                            | Дневные уникальные пользователи                                        | Охват и вовлечение         |
| Возраст, пол, страны, города подписчиков                          | Тот же: `audience_*`                                                                                        | `user.insights`, минимум 100 подписчиков                         | Распределения                                                          | Аудитория                  |
| Просмотры и уникальный охват ролика                               | `GET /business/video/list/`: `video_views`, `reach`                                                         | `video.list`                                                     | Lifetime ролика                                                        | Сопоставление результата   |
| Общее / среднее время просмотра, досмотр                          | Тот же: `total_time_watched`, `average_time_watched`, `full_video_watched_rate`                             | `video.insights`                                                 | Lifetime; время в секундах                                             | Качество просмотра         |
| Кривая удержания и моменты лайков                                 | Тот же: `video_view_retention`, `engagement_likes`                                                          | `video.insights`                                                 | По времени внутри видео                                                | Детализация удержания      |
| Источники просмотров, состав зрителей                             | Тот же: `impression_sources`, `audience_types`, `audience_genders`, `audience_countries`, `audience_cities` | `video.insights`                                                 | Распределения ролика                                                   | Источники и аудитория      |
| Тексты комментариев и ответы                                      | `GET /business/comment/list/`, `/business/comment/reply/list/`                                              | Соответствующие разрешения Accounts Comments и собственный ролик | Текст, ветки, даты; отдельная пагинация                                | Поиск вопросов для цеха    |

Источники таблицы: [Profile data](https://business-api.tiktok.com/portal/docs/get-profile-data-of-a-tiktok-account/v1.3), [Post data](https://business-api.tiktok.com/portal/docs/get-post-data-of-a-tiktok-account/v1.3), [Comments workflow](https://business-api.tiktok.com/portal/docs/manage-comments-on-owned-tiktok-videos/v1.3), [Comments endpoint](https://business-api.tiktok.com/portal/docs/get-comments-on-an-owned-video/v1.3).

Дневная аналитика профиля и lifetime аналитика ролика — разные наборы. Engagement роликов не ограничен 60-дневным окном профиля, однако документация предупреждает, что данные поста перестают обновляться через 365 дней после публикации. Доступность полей зависит от того, показывает ли их TikTok Analytics самому владельцу. [Post data](https://business-api.tiktok.com/portal/docs/get-post-data-of-a-tiktok-account/v1.3).

Метаданные обновляются оперативно, офлайн-метрики обычно задержаны на 24–48 часов UTC. `followers_count` может встречаться как текущий total и как дневное изменение в разных частях ответа — сохранять контекст поля. [Accounts Insights data latency](https://business-api.tiktok.com/portal/docs/accounts-insights-data-latency/v1.3).

Для account `video_views` документация прямо включает органическую и платную активность. Для постов предусмотрены `is_ad` и рекламные варианты размещения. Поэтому график из этих данных нельзя автоматически подписывать «только органика». [Profile data](https://business-api.tiktok.com/portal/docs/get-profile-data-of-a-tiktok-account/v1.3), [Post data](https://business-api.tiktok.com/portal/docs/get-post-data-of-a-tiktok-account/v1.3).

Наличие только `include_replies=true` в Comments не гарантирует загрузку всей ветки: вложенный список ограничен тремя ответами, остальные берутся отдельным методом. Размер страницы до 30; возможны неполные страницы и дубли при больших обсуждениях. Число комментариев ролика нельзя подменять количеством скачанных строк. [Comments endpoint](https://business-api.tiktok.com/portal/docs/get-comments-on-an-owned-video/v1.3).

**Непроверенное на аккаунте:** доступ конкретного приложения, полный список разрешённых ему scopes, наличие метрик у аккаунта Егора, текущие выделенные лимиты Accounts. Это проверяется после выдачи доступа. Отсутствие такого подтверждения не отменяет документированное существование удержания и дневных insights. Публичные страницы Business-портала прочитаны после JavaScript-рендеринга; старые ссылки с `?id=` местами перенаправляются на общий раздел, поэтому выше приведены действующие смысловые URL.

## 4. Research API и комментарии чужих видео

Research предусматривает отдельное одобрение исследовательского проекта и client access token. Обычной регистрации разработчика недостаточно; создатели контента, рекламодатели и коммерческие пользователи не подходят под условия программы. Конкретную допустимость учреждения и страны нужно проверять по текущим условиям при подаче заявки. Для коммерческого e-content этот путь не закладываем. [Getting started](https://developers.tiktok.com/docs/en/research-api-get-started), [Research FAQ](https://developers.tiktok.com/docs/en/research-api-faq).

`POST /v2/research/video/comment/list/` действительно возвращает тексты и связи ответов с `research.data.basic`. Наличие этого endpoint не даёт Display-приложению права собирать комментарии произвольного конкурента. [Query Video Comments](https://developers.tiktok.com/docs/en/research-api-specs-query-video-comments).

### Другие способы получения комментариев своих видео

Расширенный API статистики и сбор текстов комментариев не должны быть одной обязательной интеграцией. Например, поддерживаемый Apify сборщик [Clockworks TikTok Comments Scraper](https://apify.com/clockworks/tiktok-comments-scraper) принимает URL роликов или username и документирует выгрузку текста, даты, идентификатора, лайков и ответов в JSON/CSV. Это сторонний сбор публичных данных, не официальный TikTok Accounts API и не гарантия полноты. Размер выгрузки, ответы, недоступные ролики и дубли нужно проверять на реальных видео до выбора поставщика. В рамках этой работы сервис не запускался и данные ему не передавались.

Собственный сборщик через браузер — ещё один возможный адаптер, но его совместимость с интерфейсом TikTok и доступность комментариев требуют отдельной проверки. Сам факт авторизации владельца не гарантирует доступ к полной истории.

В документированном [Data Portability archive](https://developers.tiktok.com/docs/en/data-portability-data-types) есть раздел Comments с датой, текстом и ссылкой на исходный пост; документ не гарантирует полноценную выгрузку всех входящих комментариев под своими роликами. Поэтому личный архив не считаем подтверждённой заменой Comments API.

Предлагаемый общий вход анализа: ID ролика и комментария, текст, время, число лайков, связь с родительской репликой, исходная ссылка, источник сбора и сведения о полноте. Хранение и удаление дублей отделены от получения данных. Темы и идеи должны ссылаться на исходные реплики; опубликованный счётчик комментариев не подменяется числом загруженных текстов.

## 5. Предлагаемая структура аналитики

Ниже **продуктовые рекомендации**, а не дополнительные гарантии API. Они основаны на матрицах выше. Удалённые «Время публикации» и «Публикации» не возвращаем; таблицу публикаций и временную heatmap не добавляем.

| Приоритет | Блок                                                                        | Условие появления                                                              |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1         | **Аудитория:** размер и динамика                                            | Telegram stats или накопленные снимки; для TikTok разделять Display и Accounts |
| 1         | **Активность:** просмотры, реакции/лайки, комментарии, репосты              | Только подтверждённые совместимые показатели и доступный период                |
| 1         | **Источники роста и охвата**                                                | Telegram source graphs; TikTok Accounts impression sources                     |
| 2         | **Качество просмотра:** среднее время, досмотр, удержание выбранного ролика | TikTok Accounts `video.insights`                                               |
| 2         | **Приход и отток**                                                          | Telegram доступный график; TikTok Accounts Advanced / Verified                 |
| 2         | **Аудитория:** языки Telegram; география, возраст и тип зрителя TikTok      | Соответствующие capabilities и пороги                                          |
| 3         | **Уведомления Telegram**                                                    | `enabled_notifications`, `mute_graph`                                          |

Не следует превращать пропуск в ноль, складывать уникальный охват двух платформ как уникальных людей, суммировать дневных уникальных пользователей в уникальных за месяц, сравнивать lifetime с daily или общие взаимодействия называть уникальными людьми. Сумма подписчиков Telegram и TikTok тоже означает сумму подписок на площадках: один человек может учитываться дважды. Это правила нашей модели данных, вытекающие из различий API выше.

Если нужен собственный коэффициент взаимодействия, фиксируем формулу, например `(лайки + комментарии + репосты) / просмотры × 100%`, и явно различаем состав числителя у Telegram и TikTok. Этот вычисляемый коэффициент не является готовой унифицированной метрикой платформ.

## 6. План внедрения

1. **Разделить адаптеры:** `telegram-bot`, `telegram-mtproto`, `tiktok-display`, `tiktok-accounts`. Каждый возвращает поддерживаемые метрики и ограничения доступа. Выбор интерфейса зависит от capabilities, а не от названия платформы.
2. **Хранить происхождение:** platform, account, entity, metric, value, unit, source API, fetched_at, period_start/end, timezone, aggregation (`snapshot`, `daily`, `lifetime`, `distribution`), coverage и доступность. Markdown оставить для материалов, статистические точки хранить структурированно в БД.
3. **Начать с разрешённой базы:** текущие значения и регулярные snapshots; не восстанавливать несуществующую историю. Для Telegram отдельно проверить пользовательский доступ к статистике, для TikTok — путь одобрения приложения.
4. **После Accounts-доступа:** загрузить доступные 60 дней профиля, обновлять последние дни повторно с учётом задержки, отдельно собирать lifetime видео и удержание. Не переносить квоты Display на Accounts.
5. **Разделить сбор и анализ:** загрузка комментариев — самостоятельная возможность источника; тематические выводы цеха опираются на реально полученные тексты, не на `comment_count`.
6. **Расширять страницу последовательно:** активность и источники, затем аудитория и качество просмотра при подтверждении разрешений. Все новые блоки сохраняют текущую монохромную систему и плавные переходы; показывают фактическое состояние без дополнительных плашек о формате локального запуска.

### Что остаётся подтвердить перед подключением

- Право `can_view_stats` и доступ к обсуждениям выбранного Telegram-канала.
- Возможность регистрации и одобрения именно e-content в нужной программе TikTok.
- Тип TikTok-аккаунта, выдаваемые scopes и доступные поля его Analytics.
- Реальные сроки токенов из ответов, лимиты конкретного приложения и поведение отсутствующих/задержанных данных.

До этих проверок документ служит картой возможностей и архитектурных ограничений, а не утверждением, что все перечисленные данные уже доступны текущему аккаунту.
