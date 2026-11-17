import test from 'node:test';
import assert from 'node:assert/strict';
import bigInt from 'big-integer';
import { Api } from 'teleproto';
import { TelegramGateway } from '../telegram.ts';

const channel = (id: number) =>
  new Api.Channel({
    id: bigInt(id),
    accessHash: bigInt(501),
    title: 'Fixture',
    photo: new Api.ChatPhotoEmpty(),
    date: 1,
    megagroup: true,
  });
const message = (id: number) =>
  new Api.Message({
    id,
    peerId: new Api.PeerChannel({ channelId: bigInt(999) }),
    date: 123,
    message: 'Как правильно проверить сценарий?',
  });
test('adapter keeps service-message cursors and resolves the distinct discussion root', async () => {
  const gateway = new TelegramGateway({ apiId: 123456, apiHash: 'a'.repeat(32) });
  const target = {
    id: 'channel:100',
    channelId: '100',
    input: new Api.InputPeerChannel({ channelId: bigInt(100), accessHash: bigInt(501) }),
  };
  const calls: { request: Api.AnyRequest; options: unknown }[] = [];
  let budget = 0;
  gateway.beforeRequest = async () => {
    budget++;
  };
  gateway.client.invoke = (async (request: Api.AnyRequest, _dc: unknown, options: unknown) => {
    calls.push({ request, options });
    if (request instanceof Api.messages.GetHistory)
      return new Api.messages.Messages({
        topics: [],
        messages: [
          new Api.MessageService({
            id: 101,
            date: 123,
            peerId: new Api.PeerChannel({ channelId: bigInt(100) }),
            action: new Api.MessageActionEmpty(),
          }),
        ],
        chats: [],
        users: [],
      });
    if (request instanceof Api.messages.GetDiscussionMessage)
      return new Api.messages.DiscussionMessage({
        messages: [message(907), message(900)],
        unreadCount: 0,
        chats: [channel(999)],
        users: [],
      });
    if (request instanceof Api.messages.GetReplies)
      return new Api.messages.Messages({
        messages: [message(907)],
        topics: [],
        chats: [],
        users: [],
      });
    throw new Error('Unexpected request');
  }) as typeof gateway.client.invoke;
  try {
    const page = await gateway.posts(target, 0, 500, 50);
    assert.deepEqual(page, { items: [], count: 1, cursor: 101 });
    const discussion = await gateway.discussion(target, 42);
    assert.equal(discussion?.root, 900);
    assert.equal(discussion?.peer.id, 'channel:999');
    await gateway.comments(discussion!.peer, discussion!.root, 0, 500, 12);
    const replies = calls[2].request as Api.messages.GetReplies;
    assert.equal(replies.msgId, 900);
    assert.equal(replies.limit, 12);
    assert.equal((replies.peer as Api.InputPeerChannel).channelId.toString(), '999');
    assert.equal(budget, 3);
    for (const call of calls)
      assert.equal((call.options as { maxRetryCount: number }).maxRetryCount, 0);
    assert.ok(!calls.some(({ request }) => request instanceof Api.channels.JoinChannel));
  } finally {
    await gateway.disconnect();
  }
});

test('adapter retains Telegram-provided code length and rejects implicit registration', async () => {
  const gateway = new TelegramGateway({ apiId: 123456, apiHash: 'a'.repeat(32) });
  gateway.client.invoke = (async (request: Api.AnyRequest) => {
    if (request instanceof Api.auth.SendCode)
      return new Api.auth.SentCode({
        phoneCodeHash: 'fixture',
        type: new Api.auth.SentCodeTypeApp({ length: 5 }),
      });
    return new Api.auth.AuthorizationSignUpRequired({});
  }) as typeof gateway.client.invoke;
  try {
    assert.equal((await gateway.sendCode('+79000000000')).length, 5);
    await assert.rejects(gateway.signIn('+79000000000', 'fixture', '12345'), /зарегистрируйте/);
  } finally {
    await gateway.disconnect();
  }
});
