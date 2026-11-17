import bigInt from 'big-integer';
import {
  TelegramClient,
  Api,
  utils,
  password,
  Logger,
  SocksTransport,
  HttpProxyTransport,
} from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { LogLevel } from 'teleproto/extensions/Logger';
import { AppError } from './errors.ts';
import type { AnalysisSource } from '../src/features/sources/model.ts';

export type TelegramCredentials = { apiId: number; apiHash: string };
export type Peer = { id: string; channelId: string; username?: string; input: Api.TypeInputPeer };
export type TelegramMessage = {
  id: number;
  date: number;
  text: string;
  forwarded: boolean;
  replyTo?: number;
  topId?: number;
  commentCount: number;
  metrics: { views?: number; forwards?: number; reactions?: number };
};
export type TelegramPage = { items: TelegramMessage[]; count: number; cursor: number };
function page(messages: Api.TypeMessage[]): TelegramPage {
  return {
    items: messages.map(message).filter((item) => item !== null),
    count: messages.length,
    cursor: messages.at(-1)?.id ?? 0,
  };
}
export type Gateway = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendCode(
    phone: string,
  ): Promise<{ hash: string; length: number; delivery: string; authorized?: boolean }>;
  signIn(phone: string, hash: string, code: string): Promise<void>;
  passwordHint(): Promise<string>;
  checkPassword(value: string): Promise<void>;
  account(): Promise<{ id: string; displayName: string; handle?: string }>;
  session(): string;
  revoke(): Promise<void>;
  beforeRequest?: (signal?: AbortSignal) => Promise<void>;
  resolve(source: AnalysisSource, signal?: AbortSignal): Promise<Peer>;
  posts(
    peer: Peer,
    offset: number,
    until: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<TelegramPage>;
  post(peer: Peer, id: number, signal?: AbortSignal): Promise<TelegramMessage | null>;
  discussion(
    peer: Peer,
    id: number,
    signal?: AbortSignal,
  ): Promise<{ peer: Peer; root: number } | null>;
  comments(
    peer: Peer,
    root: number,
    offset: number,
    until: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<TelegramPage>;
};

function message(value: Api.TypeMessage): TelegramMessage | null {
  if (!(value instanceof Api.Message)) return null;
  return {
    id: value.id,
    date: value.date,
    text: value.message ?? '',
    forwarded: !!value.fwdFrom,
    replyTo:
      value.replyTo instanceof Api.MessageReplyHeader ? value.replyTo.replyToMsgId : undefined,
    topId: value.replyTo instanceof Api.MessageReplyHeader ? value.replyTo.replyToTopId : undefined,
    commentCount: value.replies?.replies ?? 0,
    metrics: {
      views: value.views,
      forwards: value.forwards,
      reactions: value.reactions?.results.reduce((sum, item) => sum + item.count, 0),
    },
  };
}
function peer(entity: Api.TypeChat): Peer {
  if (!(entity instanceof Api.Channel) && !(entity instanceof Api.Chat))
    throw new AppError(400, 'CHANNEL_UNAVAILABLE', 'Этот канал недоступен аккаунту.');
  return {
    id: `${entity instanceof Api.Channel ? 'channel' : 'chat'}:${entity.id}`,
    channelId: entity.id.toString(),
    username: entity instanceof Api.Channel ? entity.username : undefined,
    input: utils.getInputPeer(entity),
  };
}
function transport() {
  const configured = process.env.TELEGRAM_PROXY_URL;
  if (!configured) return undefined;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new AppError(500, 'PROXY_CONFIG', 'Проверьте TELEGRAM_PROXY_URL.');
  }
  if (!['socks5:', 'http:', 'https:'].includes(url.protocol))
    throw new AppError(500, 'PROXY_CONFIG', 'Прокси должен использовать SOCKS5 или HTTP CONNECT.');
  const options = {
    host: url.hostname,
    port: Number(
      url.port || (url.protocol === 'https:' ? 443 : url.protocol === 'http:' ? 80 : 1080),
    ),
    username: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined,
    timeout: 10,
  };
  return url.protocol === 'socks5:'
    ? new SocksTransport({ ...options, version: 5 })
    : new HttpProxyTransport({ ...options, tls: url.protocol === 'https:' });
}

export class TelegramGateway implements Gateway {
  readonly client: TelegramClient<StringSession>;
  beforeRequest?: (signal?: AbortSignal) => Promise<void>;
  constructor(
    private credentials: TelegramCredentials,
    session = '',
  ) {
    this.client = new TelegramClient(
      new StringSession(session),
      credentials.apiId,
      credentials.apiHash,
      {
        connectionRetries: 2,
        requestRetries: 1,
        floodSleepThreshold: 0,
        timeout: 15,
        deviceModel: 'e-content local',
        appVersion: '0.4.0',
        baseLogger: new Logger(LogLevel.NONE),
        transport: transport(),
      },
    );
  }
  async connect() {
    await this.client.connect();
  }
  async disconnect() {
    await this.client.destroy();
  }
  session() {
    return this.client.session.save();
  }
  private auth<R extends Api.AnyRequest>(request: R) {
    return this.client.invoke(request, undefined, {
      timeout: 25000,
      maxRetryCount: 1,
      floodSleepThreshold: 0,
    });
  }
  private async rpc<R extends Api.AnyRequest>(request: R, signal?: AbortSignal) {
    signal?.throwIfAborted();
    await this.beforeRequest?.(signal);
    return this.client.invoke(request, undefined, {
      abortSignal: signal,
      timeout: 25000,
      maxRetryCount: 0,
      floodSleepThreshold: 0,
    });
  }
  async sendCode(phone: string) {
    const result = await this.auth(
      new Api.auth.SendCode({
        phoneNumber: phone,
        ...this.credentials,
        settings: new Api.CodeSettings({}),
      }),
    );
    if (result instanceof Api.auth.SentCodeSuccess) {
      if (!(result.authorization instanceof Api.auth.Authorization))
        throw new AppError(
          400,
          'SIGNUP_REQUIRED',
          'Сначала зарегистрируйте аккаунт в приложении Telegram.',
        );
      return { hash: '', length: 0, delivery: '', authorized: true };
    }
    if (!(result instanceof Api.auth.SentCode))
      throw new AppError(
        400,
        'AUTH_UNSUPPORTED',
        'Telegram предложил способ входа, который пока не поддерживается. Попробуйте другой номер или позже.',
      );
    if (
      !(result.type instanceof Api.auth.SentCodeTypeApp) &&
      !(result.type instanceof Api.auth.SentCodeTypeSms) &&
      !(result.type instanceof Api.auth.SentCodeTypeCall)
    )
      throw new AppError(
        400,
        'AUTH_UNSUPPORTED',
        'Для этого входа Telegram требует дополнительный способ подтверждения. Используйте вход через код в Telegram или SMS.',
      );
    return {
      hash: result.phoneCodeHash,
      length: result.type.length,
      delivery:
        result.type instanceof Api.auth.SentCodeTypeApp
          ? 'telegram'
          : result.type instanceof Api.auth.SentCodeTypeSms
            ? 'sms'
            : 'call',
    };
  }
  async signIn(phone: string, hash: string, code: string) {
    const result = await this.auth(
      new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash: hash, phoneCode: code }),
    );
    if (!(result instanceof Api.auth.Authorization))
      throw new AppError(
        400,
        'SIGNUP_REQUIRED',
        'Сначала зарегистрируйте аккаунт в приложении Telegram.',
      );
  }
  async passwordHint() {
    return (await this.auth(new Api.account.GetPassword())).hint ?? '';
  }
  async checkPassword(value: string) {
    const settings = await this.auth(new Api.account.GetPassword());
    await this.auth(
      new Api.auth.CheckPassword({ password: await password.computeCheck(settings, value) }),
    );
  }
  async account() {
    const result = await this.auth(new Api.users.GetUsers({ id: [new Api.InputUserSelf()] }));
    const user = result[0];
    if (!(user instanceof Api.User) || user.bot)
      throw new AppError(400, 'USER_ACCOUNT_REQUIRED', 'Нужен пользовательский аккаунт Telegram.');
    return {
      id: `telegram:${user.id}`,
      displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Telegram',
      handle: user.username ? `@${user.username}` : undefined,
    };
  }
  async revoke() {
    await this.auth(new Api.auth.LogOut());
  }
  async resolve(source: AnalysisSource, signal?: AbortSignal): Promise<Peer> {
    const parts = new URL(source.url).pathname.split('/').filter(Boolean);
    if (parts[0] !== 'c') {
      const result = await this.rpc(
        new Api.contacts.ResolveUsername({ username: parts[0] }),
        signal,
      );
      const channel = result.chats.find(
        (item) => item instanceof Api.Channel || item instanceof Api.Chat,
      );
      if (!channel)
        throw new AppError(
          400,
          'CHANNEL_REQUIRED',
          'Ссылка должна вести на канал или публикацию, а не на личный профиль.',
        );
      return peer(channel);
    }
    let offsetDate = 0,
      offsetId = 0,
      offsetPeer: Api.TypeInputPeer = new Api.InputPeerEmpty();
    for (;;) {
      const result = await this.rpc(
        new Api.messages.GetDialogs({
          offsetDate,
          offsetId,
          offsetPeer,
          limit: 100,
          hash: bigInt.zero,
          excludePinned: offsetId > 0,
        }),
        signal,
      );
      if (result instanceof Api.messages.DialogsNotModified) break;
      const found = result.chats.find(
        (item) =>
          (item instanceof Api.Channel || item instanceof Api.Chat) &&
          item.id.toString() === parts[1],
      );
      if (found) return peer(found);
      const lastDialog = result.dialogs.at(-1);
      if (!(lastDialog instanceof Api.Dialog)) break;
      const last = result.messages.find(
        (item) =>
          (item instanceof Api.Message || item instanceof Api.MessageService) &&
          item.id === lastDialog.topMessage &&
          utils.getPeerId(item.peerId).toString() === utils.getPeerId(lastDialog.peer).toString(),
      );
      if (!last || !(last instanceof Api.Message || last instanceof Api.MessageService)) break;
      if (
        last.id === offsetId &&
        utils.getPeerId(last.peerId).toString() === utils.getPeerId(offsetPeer).toString()
      )
        break;
      const entity = [...result.chats, ...result.users].find((item) => {
        try {
          return utils.getPeerId(item).toString() === utils.getPeerId(lastDialog.peer).toString();
        } catch {
          return false;
        }
      });
      if (!entity) break;
      offsetPeer = utils.getInputPeer(entity);
      offsetDate = last.date;
      offsetId = last.id;
    }
    throw new AppError(
      400,
      'CHANNEL_PRIVATE',
      'Закрытый канал не найден среди доступных диалогов аккаунта.',
    );
  }
  async posts(
    target: Peer,
    offsetId: number,
    offsetDate: number,
    limit: number,
    signal?: AbortSignal,
  ) {
    const result = await this.rpc(
      new Api.messages.GetHistory({
        peer: target.input,
        offsetId,
        offsetDate,
        addOffset: 0,
        limit,
        maxId: 0,
        minId: 0,
        hash: bigInt.zero,
      }),
      signal,
    );
    return page('messages' in result ? result.messages : []);
  }
  async post(target: Peer, id: number, signal?: AbortSignal) {
    const ids = [new Api.InputMessageID({ id })];
    const result =
      target.input instanceof Api.InputPeerChannel
        ? await this.rpc(
            new Api.channels.GetMessages({ channel: utils.getInputChannel(target.input), id: ids }),
            signal,
          )
        : await this.rpc(new Api.messages.GetMessages({ id: ids }), signal);
    return 'messages' in result && result.messages.length ? message(result.messages[0]) : null;
  }
  async discussion(target: Peer, id: number, signal?: AbortSignal) {
    const result = await this.rpc(
      new Api.messages.GetDiscussionMessage({ peer: target.input, msgId: id }),
      signal,
    );
    const root = result.messages.at(-1);
    if (!(root instanceof Api.Message) || !(root.peerId instanceof Api.PeerChannel)) return null;
    const channel = result.chats.find(
      (item) =>
        item instanceof Api.Channel &&
        item.id.toString() === (root.peerId as Api.PeerChannel).channelId.toString(),
    );
    return channel ? { peer: peer(channel), root: root.id } : null;
  }
  async comments(
    target: Peer,
    msgId: number,
    offsetId: number,
    offsetDate: number,
    limit: number,
    signal?: AbortSignal,
  ) {
    const result = await this.rpc(
      new Api.messages.GetReplies({
        peer: target.input,
        msgId,
        offsetId,
        offsetDate,
        addOffset: 0,
        limit,
        maxId: 0,
        minId: 0,
        hash: bigInt.zero,
      }),
      signal,
    );
    return page('messages' in result ? result.messages : []);
  }
}
