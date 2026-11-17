const server = 'http://127.0.0.1:5187/api/zen-bridge';
const origin = browser.runtime.getURL('/').replace(/\/$/, '');
let queued = null;
let token = '',
  running = null,
  polling = false,
  online = false,
  lastError = '';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(path, body) {
  const response = await fetch(server + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'omit',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'X-EContent-Extension': origin,
      'X-EContent-Version': browser.runtime.getManifest().version,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = Error(result.error?.message || 'Локальный сервер недоступен.');
    error.code = result.error?.code;
    throw error;
  }
  return result;
}
function check(job) {
  if (job !== running || job.cancelled) throw Error('Сбор остановлен в цехе.');
  if (job.error) throw job.error;
}
async function event(job, type, data) {
  check(job);
  return api('/event', { id: job.task.id, type, data });
}
function capture(job, url, data) {
  if (url.pathname === '/api/post/item_list/') {
    const items = data.itemList ?? data.item_list;
    if ((data.statusCode ?? data.status_code ?? 0) !== 0 || !Array.isArray(items)) {
      job.captureError = captureFailure(
        'TikTok не выдал подтверждённый список роликов.',
        'ZEN_RESPONSE_BODY',
        job.phase,
      );
      return;
    }
    for (const item of items) if (item?.id) job.videos.set(String(item.id), item);
    job.profileComplete ||=
      data.hasMore === false ||
      data.hasMore === 0 ||
      data.has_more === false ||
      data.has_more === 0;
    job.generation++;
  } else {
    const videoId = url.searchParams.get('aweme_id') || url.searchParams.get('item_id');
    if (!videoId || videoId !== job.videoId) return;
    const root = url.pathname.endsWith('/reply/') ? url.searchParams.get('comment_id') : undefined;
    job.pages.push({ videoId, parentId: root || undefined, page: data });
    job.generation++;
  }
}
function captureFailure(message, code, phase) {
  const error = Error(message);
  error.code = code;
  error.stage = 'filter:' + phase;
  return error;
}
function observeResponse(job, details, url) {
  const epoch = job.epoch;
  const active = () => job === running && !job.cancelled && job.epoch === epoch;
  const filter = browser.webRequest.filterResponseData(details.requestId);
  const chunks = [];
  let size = 0;
  filter.ondata = ({ data: bytes }) => {
    filter.write(bytes);
    if (!active()) return;
    size += bytes.byteLength;
    if (size <= 5000000) chunks.push(new Uint8Array(bytes));
  };
  filter.onstop = () => {
    filter.close();
    if (!active()) return;
    if (size > 5000000) {
      job.error = Error('Ответ TikTok превысил допустимый объём.');
      return;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.length;
    }
    try {
      capture(job, url, JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      job.captureError = captureFailure(
        'Не удалось прочитать ответ со списком роликов или комментариями. Полученные данные сохранены.',
        'ZEN_RESPONSE_BODY',
        job.phase,
      );
    }
  };
  filter.onerror = () => {
    if (!active()) return;
    job.captureError = captureFailure(
      'Не удалось подключить чтение ответа TikTok. Повторите проверку аккаунта.',
      'ZEN_RESPONSE_FILTER',
      job.phase,
    );
  };
  return filter;
}
browser.webRequest.onBeforeRequest.addListener(
  async (details) => {
    const job = running;
    if (!job || details.tabId !== job.tabId) return;
    const url = new URL(details.url);
    const profileData = job.phase === 'profile' && url.pathname === '/api/post/item_list/';
    const commentsData =
      job.phase === 'video' &&
      ['/api/comment/list/', '/api/comment/list/reply/'].includes(url.pathname) &&
      (url.searchParams.get('aweme_id') || url.searchParams.get('item_id')) === job.videoId;
    const data = profileData || commentsData;
    if (
      details.type !== 'main_frame' &&
      !data &&
      !url.pathname.startsWith('/passport/web/account/info/')
    )
      return;
    let filter;
    try {
      check(job);
      if (data) {
        try {
          filter = observeResponse(job, details, url);
        } catch {
          job.captureError = captureFailure(
            'Не удалось подключить чтение ответа TikTok. Повторите проверку аккаунта.',
            'ZEN_RESPONSE_FILTER',
            job.phase,
          );
        }
      }
      const result = await event(job, 'permit');
      if (!result.allowed) {
        try {
          filter?.disconnect();
        } catch {}
        return { cancel: true };
      }
    } catch (error) {
      try {
        filter?.disconnect();
      } catch {}
      job.error = error;
      return { cancel: true };
    }
  },
  { urls: ['https://www.tiktok.com/*'] },
  ['blocking'],
);

async function navigate(job, url) {
  check(job);
  let listener, timer;
  const loaded = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(Error('TikTok не загрузил страницу за отведённое время.'));
    }, 30000);
    listener = (id, change, tab) => {
      if (id !== job.tabId || change.status !== 'complete') return;
      if (!tab.url?.startsWith('https://www.tiktok.com/')) return;
      const expected = new URL(url).pathname.replace(/\/$/, '');
      const actual = new URL(tab.url).pathname.replace(/\/$/, '');
      if (expected && actual !== expected && !actual.startsWith('/login')) return;
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };
    browser.tabs.onUpdated.addListener(listener);
  });
  try {
    await browser.tabs.update(job.tabId, { url });
    const tab = await loaded;
    check(job);
    if (!tab.url?.startsWith('https://www.tiktok.com/'))
      throw Error('TikTok перенаправил на другую страницу.');
    await wait(800);
    check(job);
  } finally {
    clearTimeout(timer);
    browser.tabs.onUpdated.removeListener(listener);
  }
}
async function page(job, action) {
  check(job);
  job.stage = 'read:' + action;
  const result = await EContentPage.read(browser, job.tabId, action, () => check(job), wait);
  if (result?.error) {
    const error = Error(result.error.message);
    error.code = result.error.code;
    throw error;
  }
  return result || {};
}
async function profile(job, handle) {
  job.phase = 'profile';
  job.epoch++;
  job.captureError = undefined;
  job.videos.clear();
  job.profileComplete = false;
  await navigate(job, 'https://www.tiktok.com/@' + handle);
  const snapshot = await page(job, 'snapshot');
  for (const item of snapshot.items || []) if (item?.id) job.videos.set(String(item.id), item);
  let previous = -1,
    stagnant = 0;
  for (let i = 0; i < 24; i++) {
    check(job);
    if (job.profileComplete || job.videos.size >= Math.max(30, job.task.maxVideos * 2)) break;
    stagnant = previous === job.videos.size ? stagnant + 1 : 0;
    previous = job.videos.size;
    if (stagnant >= 5) break;
    await page(job, 'scrollProfile');
    await wait(1000);
  }
  const items = [...job.videos.values()].filter(
    (v) => v.author?.uniqueId?.toLowerCase() === handle.toLowerCase(),
  );
  items.sort(
    (a, b) =>
      Number(b.createTime || 0) - Number(a.createTime || 0) ||
      String(b.id).localeCompare(String(a.id)),
  );
  if (!items.length && !job.profileComplete)
    throw job.captureError || Error('TikTok не выдал список роликов профиля.');
  const selected = items.slice(0, job.task.maxVideos);
  await event(job, 'profile', {
    items: selected,
    complete: job.profileComplete && selected.every((v) => v.createTime),
  });
  return selected;
}
async function flush(job) {
  for (; job.sent < job.pages.length; job.sent++) {
    const entry = job.pages[job.sent],
      data = entry.page;
    if (!Array.isArray(data.comments)) {
      const error = Error('TikTok не выдал подтверждённую страницу комментариев.');
      error.code = 'TIKTOK_SCHEMA';
      throw error;
    }
    await event(job, 'comments', entry);
    if (!entry.parentId) job.rootMore = !!data.has_more;
    else job.replyMore.set(entry.parentId, !!data.has_more);
    for (const comment of data.comments) {
      if (!entry.parentId)
        job.roots.set(String(comment.cid), Number(comment.reply_comment_total || 0));
      for (const row of [comment, ...(job.task.replies ? comment.reply_comment || [] : [])]) {
        const parent =
          row.reply_id && String(row.reply_id) !== '0' ? String(row.reply_id) : entry.parentId;
        if (!job.task.replies && parent) continue;
        const key = String(row.cid);
        if (!job.seen.has(key)) {
          job.seen.add(key);
          if (parent) job.parents.set(key, parent);
        }
      }
    }
  }
}
async function openComments(job) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    check(job);
    if (job.pages.some((entry) => !entry.parentId)) return;
    const result = await page(job, 'openComments');
    if (result.opened) return;
    await wait(300);
  }
  const error = Error(
    'Панель комментариев TikTok не появилась за отведённое время. Полученные данные ролика сохранены.',
  );
  error.code = 'ZEN_COMMENTS_UI';
  throw error;
}
async function collectVideo(job, raw, handle) {
  job.phase = 'video';
  job.epoch++;
  job.captureError = undefined;
  job.videoId = String(raw.id);
  job.pages = [];
  job.sent = 0;
  job.rootMore = undefined;
  job.roots = new Map();
  job.replyMore = new Map();
  job.parents = new Map();
  await navigate(job, `https://www.tiktok.com/@${handle}/video/${raw.id}`);
  const snapshot = await page(job, 'snapshot');
  const video =
    snapshot.video?.id && String(snapshot.video.id) === job.videoId ? snapshot.video : raw;
  await event(job, 'video', video);
  if (!job.task.comments) return;
  if (job.seen.size >= job.task.maxComments) {
    job.limited = true;
    return;
  }
  await openComments(job);
  let stagnant = 0,
    previous = -1;
  for (let i = 0; i < 120; i++) {
    check(job);
    await wait(700);
    await flush(job);
    if (job.seen.size >= job.task.maxComments) {
      job.limited = true;
      break;
    }
    if (job.rootMore === false) break;
    stagnant = previous === job.generation ? stagnant + 1 : 0;
    previous = job.generation;
    if (stagnant >= 12) break;
    await page(job, 'scrollComments');
  }
  if (
    !job.pages.some((entry) => !entry.parentId) &&
    !(
      Number(video.statsV2?.commentCount ?? video.stats?.commentCount) === 0 &&
      snapshot.emptyComments
    )
  )
    throw (
      job.captureError ||
      Error('TikTok не выдал комментарии этого ролика. Полученные записи сохранены.')
    );
  if (
    job.pages.length &&
    job.roots.size === 0 &&
    Number(video.statsV2?.commentCount ?? video.stats?.commentCount) > 0
  )
    throw Error('В счётчике TikTok есть комментарии, но их тексты не получены.');
  if (job.task.replies) {
    for (let i = 0; i < 100 && job.seen.size < job.task.maxComments; i++) {
      const result = await page(job, 'replies');
      if (!result.opened) break;
      await wait(1000);
      await flush(job);
    }
  }
  const missing = [...job.roots].some(
    ([id, count]) =>
      count > [...job.parents.values()].filter((parent) => parent === id).length ||
      job.replyMore.get(id) === true,
  );
  job.limited ||= job.rootMore === true || (job.task.replies && missing);
  await event(job, 'progress', {
    status: job.limited ? 'limited' : 'reading',
    reason: job.limited ? 'TikTok выдал часть комментариев или достигнут лимит.' : undefined,
  });
}
async function runTask(task) {
  const job = {
    task,
    phase: 'identity',
    epoch: 0,
    tabId: -1,
    cancelled: false,
    videos: new Map(),
    pages: [],
    seen: new Set(),
    generation: 0,
    limited: false,
  };
  running = job;
  try {
    const tabs = await browser.tabs.query({ url: 'https://www.tiktok.com/*' });
    tabs.sort(
      (a, b) =>
        Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0),
    );
    const tab = tabs.length
      ? await browser.tabs.duplicate(tabs[0].id)
      : await browser.tabs.create({ url: 'about:blank', active: false });
    job.tabId = tab.id;
    await browser.tabs.update(tab.id, { active: false });
    await navigate(job, 'https://www.tiktok.com/');
    const { user } = await page(job, 'identity');
    const handle = user?.username || user?.uniqueId || user?.unique_id;
    const id = String(user?.user_id_str || user?.uid || user?.userId || user?.id || '');
    if (!/^[\w.]{2,24}$/.test(handle || '') || !/^\d+$/.test(id)) {
      const error = Error('Войдите в TikTok в Zen и повторите проверку подключения.');
      error.code = 'TIKTOK_LOGIN_REQUIRED';
      throw error;
    }
    if (task.accountId && task.accountId !== id) {
      const error = Error('В Zen открыт другой аккаунт TikTok.');
      error.code = 'TIKTOK_ACCOUNT_CHANGED';
      throw error;
    }
    await event(job, 'identity', user);
    const videos = await profile(job, handle);
    if (task.kind === 'collect') {
      for (const video of videos) {
        check(job);
        await collectVideo(job, video, handle);
      }
      await event(job, 'progress', { status: 'completed' });
    }
    await event(job, 'done');
    lastError = '';
  } catch (error) {
    lastError = error.message;
    if (!job.cancelled) {
      await api('/event', {
        id: task.id,
        type: 'error',
        data: {
          code: error.code || 'ZEN_READ',
          message: error.message,
          stage: error.stage || job.stage,
        },
      }).catch(() => {});
      if (
        ['TIKTOK_LOGIN_REQUIRED', 'TIKTOK_BLOCKED', 'TIKTOK_RATE_LIMIT'].includes(error.code) &&
        job.tabId >= 0
      ) {
        await browser.tabs.update(job.tabId, { active: true }).catch(() => {});
        job.keep = true;
      }
    }
  } finally {
    if (!job.keep && job.tabId >= 0) await browser.tabs.remove(job.tabId).catch(() => {});
    if (running === job) running = null;
    if (queued) {
      const next = queued;
      queued = null;
      void runTask(next);
    }
  }
}
async function poll() {
  if (!token || polling) return;
  polling = true;
  try {
    const state = await api('/poll');
    online = true;
    if (running && state.activeId !== running.task.id) running.cancelled = true;
    if (queued && state.activeId !== queued.id) queued = null;
    if (state.task) {
      if (running) queued = state.task;
      else void runTask(state.task);
    }
  } catch (error) {
    online = false;
    queued = null;
    if (running) running.cancelled = true;
    if (error.code === 'ZEN_AUTH') {
      token = '';
      await browser.storage.local.remove('token');
    }
  } finally {
    polling = false;
  }
}
browser.runtime.onMessage.addListener(async (message, sender) => {
  if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL('popup.html'))
    return;
  if (message.type === 'status')
    return {
      paired: !!token,
      online,
      running: !!running,
      error: lastError,
      version: browser.runtime.getManifest().version,
    };
  if (message.type === 'pair') {
    try {
      const state = await api('/pair', { code: message.code });
      token = state.token;
      await browser.storage.local.set({ token });
      lastError = '';
      await poll();
      return {};
    } catch (error) {
      return { error: error.message };
    }
  }
  if (message.type === 'forget') {
    token = '';
    online = false;
    if (running) running.cancelled = true;
    await browser.storage.local.remove('token');
    return {};
  }
});
void browser.storage.local.get('token').then((saved) => {
  token = saved.token || '';
  void poll();
});
setInterval(() => void poll(), 2000);
