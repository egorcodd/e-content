# Telegram: проверка пользовательского коннектора

Проверено **16 ноября 2026 года** по установленному `teleproto@1.233.0`, его исходникам и официальной документации Telegram. Живой вход и сбор с аккаунтов не выполнялись. Это проверка контрактов, а не подтверждение доступности любого канала. Версию библиотеки следует фиксировать; ссылки `main` могут измениться.

## Вход: отдельные шаги на сервере

Экспорты установленной версии: `import { Api, TelegramClient, password } from 'teleproto'`, `import { StringSession } from 'teleproto/sessions'`. Прямой импорт `teleproto/Password` отсутствует в публичном списке экспортов пакета. [Экспорты](https://github.com/sanyok12345/teleproto/blob/main/teleproto/index.ts), [package.json](https://github.com/sanyok12345/teleproto/blob/main/package.json).

Для HTTP-интерфейса предпочтительны явные raw-вызовы:

```ts
const sent = await client.invoke(
  new Api.auth.SendCode({
    phoneNumber,
    apiId,
    apiHash,
    settings: new Api.CodeSettings({}),
  }),
  undefined,
  callOptions,
);

const result = await client.invoke(
  new Api.auth.SignIn({ phoneNumber, phoneCodeHash, phoneCode }),
  undefined,
  callOptions,
);
```

`SendCode` возвращает объединение: `auth.SentCode`, `auth.SentCodeSuccess`, `auth.SentCodePaymentRequired`. Только первый означает обычный следующий шаг ввода кода. Второй содержит авторизацию; третий нельзя объявлять успешной отправкой SMS или автоматически оплачивать. `SignIn` также возвращает `AuthorizationSignUpRequired`: MVP подключения существующего аккаунта не должен создавать новый. [SendCode](https://core.telegram.org/method/auth.sendCode), [SignIn](https://core.telegram.org/method/auth.signIn.md).

Из `SentCode` сохраняются на сервере `phoneCodeHash`, доставка, `nextType` и `timeout`. Длина кода берётся из конкретного `sent.type.length`, **не фиксируется в шесть цифр**. Приложение/SMS/звонок, email, настройка email, FlashCall, Fragment и SMS со словом/фразой — разные режимы. Неподдержанный режим требует явного ответа интерфейсу, а не ошибки «неверный код». Повторная отправка — отдельное действие после разрешённого таймера, с обновлением хеша и режима. [Типы доставки](https://core.telegram.org/type/auth.SentCodeType), [ResendCode](https://core.telegram.org/method/auth.resendCode).

Высокоуровневый `client.sendCode(...)` сокращает результат и теряет обычные `length`/`timeout`; обрабатывает `AUTH_RESTART` рекурсивно. `start`/`signInUser` содержат циклы повторных попыток. Они не заменяют контролируемые серверные шаги. [Реализация auth](https://github.com/sanyok12345/teleproto/blob/main/teleproto/client/methods/auth.ts).

При `SESSION_PASSWORD_NEEDED` переходить к 2FA:

```ts
const params = await client.invoke(new Api.account.GetPassword(), undefined, callOptions);
const proof = await password.computeCheck(params, plaintextPassword);
const result = await client.invoke(
  new Api.auth.CheckPassword({ password: proof }),
  undefined,
  callOptions,
);
```

`computeCheck(Api.account.Password, string)` возвращает `Promise<Api.InputCheckPasswordSRP>`. Нельзя передавать пароль строкой или самодельный SHA-хеш в `CheckPassword`. При устаревшем SRP следует заново получить параметры на следующей разрешённой попытке. Различать неверный пароль, истёкший/неверный код и необходимость начать вход заново. [SRP](https://core.telegram.org/api/srp), [CheckPassword](https://core.telegram.org/method/auth.checkPassword.md), [computeCheck](https://github.com/sanyok12345/teleproto/blob/main/teleproto/Password.ts).

## Ограниченные вызовы и отмена

В версии 1.233.0 сигнатура — `client.invoke(request, dcId?, options?)`. Опции находятся **в третьем аргументе**:

```ts
const callOptions: Api.ApiCallOptions = {
  abortSignal: controller.signal,
  timeout: 20_000,
  maxRetryCount: 0,
  floodSleepThreshold: 0,
};
```

`timeout` здесь в миллисекундах, `floodSleepThreshold` в секундах. `maxRetryCount: 0` означает **одну исходную попытку**. Не заменять на конструкторное `requestRetries: 0`: реализация использует это значение как число попыток и может вообще не отправить запрос. Значение `requestRetries` по умолчанию — 5, `floodSleepThreshold` — 60. При отключённых повторах миграции DC также требуют явной ограниченной обработки, а не бесконечного повторения. [invoke](https://github.com/sanyok12345/teleproto/blob/main/teleproto/client/rpc/invoke.ts), [опции и отмена](https://github.com/sanyok12345/teleproto/blob/main/teleproto/client/rpc/RpcCallControl.ts), [настройки клиента](https://github.com/sanyok12345/teleproto/blob/main/teleproto/client/TelegramBaseClient.ts).

Положительный `FLOOD_WAIT_X` нужно возвращать исполнителю как ожидание X секунд и останавливать дальнейшие страницы до разрешённого времени. Произвольного безопасного количества сообщений Telegram не обещает. Abort прекращает ожидание и повторы, но **не отменяет уже исполненный сервером запрос**: перед фиксацией результата повторно проверить состояние операции. Успех, пришедший после отмены входа, не должен привязывать аккаунт. [Ошибки Telegram](https://core.telegram.org/api/errors), [контроль вызова](https://github.com/sanyok12345/teleproto/blob/main/teleproto/client/rpc/RpcCallControl.ts).

## Публикации и ветки комментариев

Raw-конструкторы используют camelCase:

```ts
new Api.messages.GetHistory({
  peer,
  offsetId,
  offsetDate,
  addOffset: 0,
  limit,
  maxId: 0,
  minId: 0,
  hash: bigInt.zero,
});
new Api.messages.GetDiscussionMessage({ peer: channelPeer, msgId: channelPostId });
new Api.messages.GetReplies({
  peer: discussionPeer,
  msgId: discussionRootId,
  offsetId,
  offsetDate,
  addOffset: 0,
  limit,
  maxId: 0,
  minId: 0,
  hash: bigInt.zero,
});
```

История обычно идёт от новых ID к старым; следующая страница использует минимальный полученный ID как `offsetId`. Даты — Unix-секунды. `limit` — размер страницы, обычно 1–100, не квота всей задачи. Дедупликация, контроль продвижения курсора, окно дат, общий бюджет и отмена обязательны независимо от размера ответа. `GetHistory` не имеет полей `minDate`/`maxDate`: границы проверяются отдельно с корректным `offsetDate`. [History](https://core.telegram.org/method/messages.getHistory.md), [пагинация](https://core.telegram.org/api/offsets.md).

Критичная связь: комментарии поста — ветка **автопересланного сообщения в группе обсуждений**, а не сообщения с тем же ID в канале. `GetDiscussionMessage(channelPeer, channelPostId)` получает эту связь без вступления в группу. По официальной документации ответ имеет убывающий порядок ID: **последнее сообщение — корень обсуждения**. Использовать его `peerId` и `id`, подтвердив принадлежность исходному посту по метаданным; не брать первый элемент и не подставлять ID поста как ID корня группы. [Обсуждения](https://core.telegram.org/api/discussion.md), [GetDiscussionMessage](https://core.telegram.org/method/messages.getDiscussionMessage.md).

`GetReplies(discussionPeer, discussionRootId, ...)` читает ветку. Вложенные ответы остаются в той же ветке: `replyTo.replyToTopId` обозначает корень, `replyTo.replyToMsgId` — непосредственного родителя. Если ответы отключены, сохраняются непосредственные ответы корню; вложенные записи всё равно могут приходить на просматриваемых страницах. Сохранять исходные parent/root ID, не создавать фиктивных родителей и не включать сам корень в комментарии. Ключ записи — `(peerId, messageId)`, поскольку ID сообщения не глобален. [Replies](https://core.telegram.org/method/messages.getReplies.md), [семантика веток](https://core.telegram.org/api/threads.md).

`CHANNEL_PRIVATE`/`MSG_ID_INVALID` — недоступная ветка/публикация, а не успешный пустой сбор. Не вызывать `JoinChannel`, импорт приглашений, `ReadHistory`, `ReadDiscussion` или отправку сообщений. Отсутствующие `views`, `forwards`, `reactions` не приравнивать к нулю. [Метод обсуждений и ошибки](https://core.telegram.org/method/messages.getDiscussionMessage.md), [Message](https://core.telegram.org/constructor/message).

## Сессия и отключение аккаунта

`StringSession.save()` сериализует DC/адрес/порт/ключ авторизации; Base64 **не шифрует** сессию. Хранить зашифрованно только на сервере; не возвращать в браузер, не писать в localStorage/Git/логи. Код, пароль 2FA и `phoneCodeHash` не являются постоянной моделью аккаунта. Ожидающий вход имеет срок жизни и серверный идентификатор, связанный с текущим владельцем. Это проектное требование хранения, основанное на содержимом сессии. [StringSession](https://github.com/sanyok12345/teleproto/blob/main/teleproto/sessions/StringSession.ts).

`disconnect()` закрывает соединение и не отзывает авторизацию. `auth.LogOut` завершает текущую сессию аккаунта. Обёртка `client.logOut()` ловит ошибку RPC, возвращает `false`, но всё равно отключается и удаляет локальную сессию: нельзя считать такой результат подтверждённым отзывом на стороне Telegram. При необходимости подтверждения использовать контролируемый raw `LogOut` и отдельно обрабатывать недоступность сервера. Не вызывать `ResetAuthorizations`, который затрагивает другие сессии. [LogOut](https://core.telegram.org/method/auth.logOut.md), [обёртка](https://github.com/sanyok12345/teleproto/blob/main/teleproto/client/methods/auth.ts), [ResetAuthorizations](https://core.telegram.org/method/auth.resetAuthorizations).
