# Официальный доступ TikTok для e-content

Проверено **16 ноября 2026 года**. Только официальные документы TikTok. Это исследование: приложения не регистрировались, аккаунты не подключались, запросы данных пользователей не выполнялись. Документ дополняет [разбор способов сбора](COMMENT-COLLECTION.md), не означает, что TikTok-коннектор уже работает.

## Основной вывод

У официальной статистики и текстов комментариев разные границы доступа. Для локального прототипа статистики стоит проверить **Login Kit Desktop + Display API в Sandbox**. У Display API нет метода чтения текстов комментариев. Для комментариев своих видео существует официальный **Accounts API в TikTok API for Business**, но для него предусмотрены отдельное заявление на доступ и проверка приложения. Нельзя обещать, что они будут одобрены именно для нашего личного сценария. [Display overview](https://developers.tiktok.com/docs/en/display-api-overview), [Sandbox](https://developers.tiktok.com/docs/en/add-a-sandbox), [создание Business-приложения](https://business-api.tiktok.com/portal/docs/create-a-developer-app/v1.3).

## 1. Базовая статистика через Display API

| Объект                                       | Доступные данные                                                                                              | Условие             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------- |
| Авторизованный профиль                       | ID, отображаемое имя и аватар                                                                                 | `user.info.basic`   |
| Профиль                                      | Username, биография, ссылка, отметка верификации                                                              | `user.info.profile` |
| Профиль                                      | Число подписчиков, подписок, суммарных лайков и публичных видео                                               | `user.info.stats`   |
| Публичные видео авторизованного пользователя | ID, дата, описание, ссылка, длительность и текущие `view_count`, `like_count`, `comment_count`, `share_count` | `video.list`        |

Источник профильных полей и scopes — [Get User Info](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info); видео и счётчики — [Video Object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object). `comment_count` — число, не список реплик.

`POST /v2/video/list/` возвращает публичные видео данного пользователя, по убыванию даты. До 20 видео на страницу, далее `cursor`/`has_more`. `POST /v2/video/query/` принимает до 20 ID и проверяет принадлежность видео авторизованному пользователю. Это не универсальный официальный метод статистики произвольного чужого профиля. [List Videos](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list), [Query Videos](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query).

У трёх Display-методов опубликован default rate limit: каждый отдельно — 600 запросов в минутном скользящем окне, превышение даёт HTTP 429 / `rate_limit_exceeded`. Это потолок соответствующего API, а не рекомендуемая скорость работы e-content и не квота web-scraper. [Rate Limits](https://developers.tiktok.com/docs/en/tiktok-api-v2-rate-limit).

### Что показывать на странице аналитики

Из текущих снимков можно честно показывать актуальные общие значения профиля и выбранных видео. Для временного графика e-content должен сохранять собственные снимки со временем получения. Это архитектурный вывод из модели ответа: Display-методы перечисляют текущие значения и не принимают период исторического отчёта. [Get User Info](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info), [Video Object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object).

Разница снимков — изменение наблюдаемого счётчика, а не гарантированное число событий, случившихся в этот день: удаление видео и корректировки платформы тоже меняют итог. Сумма просмотров роликов, опубликованных за 30 дней, не равна всем просмотрам аккаунта за эти 30 дней. Данные до начала наблюдения нельзя достроить выдуманными рядами. Разбивка For You/Search/Profile, удержание и среднее время просмотра не входят в приведённый Display Video Object; для них нужен отдельно подтверждённый доступ к расширенным Insights. [Video Object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object).

## 2. Локальный OAuth, Sandbox и production

Официальный Login Kit Desktop допускает callback с `http` или `https` на `localhost`/`127.0.0.1`, с обязательным портом. URI регистрируется в приложении, не содержит query/fragment; поддерживается wildcard порта. Desktop использует PKCE. Следовательно, технически возможен наш callback `http://127.0.0.1:5186/api/tiktok/callback/` с передачей в локальный backend. Это вывод для проекта, а не уже зарегистрированный адрес. [Desktop Login Kit](https://developers.tiktok.com/docs/en/login-kit-desktop).

Sandbox позволяет пробовать конфигурацию без подачи приложения на production review: до 5 sandbox и до 10 собственных TikTok-аккаунтов в target users. Добавленный target user затем отдельно проходит Login Kit authorization. Sandbox не открывает все продукты: например, Data Portability и публичная публикация через Content Posting там недоступны. Нужно фактически проверить наличие требуемых Display-scopes в созданном sandbox, а не считать любой scope автоматически выданным. [Add a Sandbox](https://developers.tiktok.com/docs/en/add-a-sandbox).

**Граница доказательств:** Sandbox описан через вход в собственные target accounts и последующую OAuth-авторизацию. Это даёт основание проверять доступ к их данным, но открытая страница не гарантирует в явном виде выдачу каждого Display-счётчика и `user.info.stats` без дополнительного согласования. Живой ответ мы не получали. Поэтому утверждение «Sandbox уже отдаёт все реальные показатели без review» здесь не подтверждено; нужен пробный ответ с известными ID собственных видео, сопоставлением счётчиков и проверкой фактически выданных scopes. Требование `user.info.stats` для подписчиков остаётся обязательным. [Sandbox](https://developers.tiktok.com/docs/en/add-a-sandbox), [Scopes Reference](https://developers.tiktok.com/docs/en/tiktok-api-scopes).

Для выпуска Display quickstart требует одобрения Login Kit/API products и нужных scopes. Production App Review Guidelines прямо исключают приложения только для private/personal use и приложения, ещё находящиеся в разработке. Также нужен полноценный внешний сайт, Privacy Policy/Terms и демонстрация использования продуктов/scopes. Поэтому локальный персональный MVP следует рассматривать как тест в Sandbox; нельзя обещать будущий production-доступ или выдавать sandbox за бессрочное разрешение личной эксплуатации. [Display Get Started](https://developers.tiktok.com/docs/en/display-api-get-started), [App Review Guidelines](https://developers.tiktok.com/docs/en/app-review-guidelines).

### Управление токенами

Секрет приложения и OAuth-токены должны оставаться на backend. После authorization code сервер получает access/refresh token, обновляет доступ и отзывает его при отключении пользователя. Актуальная документация от 5 ноября 2026 года указывает 2 часа/180 дней и обязательную замену refresh token при каждом refresh; сама документация требует пользоваться возвращёнными `expires_in` и `refresh_expires_in`, не хардкодить сроки. Старый Display quickstart всё ещё показывает иной пример 24 часа/365 дней. Реализация должна доверять текущему ответу сервера. [Manage OAuth Access Tokens](https://developers.tiktok.com/docs/en/oauth-user-access-token-management), [старый пример quickstart](https://developers.tiktok.com/docs/en/display-api-get-started).

## 3. Официальные тексты комментариев: Accounts API

Accounts API включает Insights, Moderation и Publishing. Текущий Overview описывает Personal Accounts и Business Accounts: название API for Business не является само по себе доказательством обязательного перевода каждого автора в Business Account. Конкретные функции и фактически выданные разрешения надо проверять на выбранном аккаунте. Допустимые сценарии включают работу с органическим присутствием собственных аккаунтов; право на любой последующий способ агрегирования данных из этого автоматически не следует. [Accounts Overview](https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3).

С 20 марта 2026 года для новых приложений и увеличения разрешений с TikTok Accounts scope требуется **Accounts API Access Application Form**. Также нужны одобренный developer profile, соответствующие scopes и app review. Одной авторизации аккаунта недостаточно. Руководство создания приложения упоминает 2–3 рабочих дня проверки как ориентир, не гарантию одобрения/срока. [Create a developer app](https://business-api.tiktok.com/portal/docs/create-a-developer-app/v1.3).

`GET /open_api/v1.3/business/comment/list/` читает комментарии **собственного видео авторизованного аккаунта**, в том числе скрытые в доступном владельцу режиме. Токен получается через `/tt_user/oauth2/token/`; `business_id` соответствует выданному `open_id`. Нужен ID owned video. В ответе есть текст, дата, лайки, количество ответов и связь с родителем. [Owned-video comments](https://business-api.tiktok.com/portal/docs/get-comments-on-an-owned-video/v1.3).

Пагинация имеет `cursor`/`has_more`, до 30 комментариев на страницу. Короткая страница не означает конец, если `has_more=true`. `include_replies=true` включает максимум 3 ответа на корневой комментарий; для остальных предусмотрен `/business/comment/reply/list/`. После первых 500 комментариев порядок выдачи может меняться, а записи — повторяться, поэтому нужны дедупликация и запрет ранней остановки по первой старой дате без подтверждённого порядка. [Owned-video comments](https://business-api.tiktok.com/portal/docs/get-comments-on-an-owned-video/v1.3).

В Accounts API существуют расширенные profile/post Insights, но доступ к ним нельзя вывести из наличия Display-токена. Для фактического коннектора отдельно подтверждаются разрешения, поля, временные окна и задержки обновления. Обычную рекламную отчётность Ads API нельзя выдавать за органическую аналитику личных роликов. [Accounts Overview](https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3).

## 4. Второй аккаунт

Выдача OAuth-разрешения от второго аккаунта позволяет работать с данными **второго** аккаунта. Она не даёт прав владельца на видео основного: принадлежность прямо проверяется Video Query, а Accounts comments требует owned video. Чтобы официально получить собственные подробные показатели/скрытые комментарии основного аккаунта, основному аккаунту нужно разрешить доступ соответствующему приложению. [Query Videos](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query), [Owned-video comments](https://business-api.tiktok.com/portal/docs/get-comments-on-an-owned-video/v1.3).

Второй аккаунт полезен как target user Sandbox для проверки самого OAuth и своих тестовых видео. Вход через него в неофициальный сборщик — другой способ доступа; это не официальная делегация от основного и не документированная гарантия отсутствия санкций. Не следует обещать, что регистрация запасного аккаунта устраняет риск для остальных аккаунтов или разрешает обход ограничений. Технический анализ неофициального способа нужно вести отдельно от официального OAuth.

## 5. Research API и стоимость

Research API действительно предоставляет комментарии, однако FAQ прямо отвечает отказом на eligibility для creators, advertisers и commercial users. Developer account не заменяет одобренный исследовательский проект. Поэтому это не запасной официальный способ для обычного личного e-content. [Research API FAQ](https://developers.tiktok.com/docs/en/research-api-faq).

В проверенных руководствах Display/Sandbox и Accounts API не найден прайс на каждый прочитанный комментарий или запрос. Это позволяет проектировать прямую интеграцию без платного scraper-посредника, но **отсутствие прайса в этих страницах не является подтверждением безусловной бесплатности Accounts API или выдачи доступа**. Перед production-подключением необходимо проверить условия, реально предъявленные developer portal и Accounts review; рекламный бюджет не тождественен оплате чтения organic API. [Display Get Started](https://developers.tiktok.com/docs/en/display-api-get-started), [Sandbox](https://developers.tiktok.com/docs/en/add-a-sandbox), [Create a developer app](https://business-api.tiktok.com/portal/docs/create-a-developer-app/v1.3).

## Предлагаемая последовательность

1. Зарегистрировать приложение и Sandbox с Login Kit Desktop/Display, проверить доступные scopes и добавить собственный тестовый аккаунт.
2. Проверить получение профиля и публичных видео на небольшом наборе; записывать точные ответы и фактические разрешения, хранить текущие снимки.
3. Отдельно оценить возможность Accounts API Access Application для комментариев основного аккаунта; не реализовывать его через Display credentials.
4. Для второго аккаунта сначала проверять его собственные видео/комментарии; любые дальнейшие публичные web-эксперименты отделить по сессии, данным и происхождению от официальной интеграции.
5. Не смешивать статусы «OAuth подключён», «доступ к статистике подтверждён», «доступ к комментариям подтверждён» и «сбор завершён». Каждое состояние требует собственного фактического подтверждения.
