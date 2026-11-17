(() => {
  const json = (id) => {
    try {
      return JSON.parse(document.getElementById(id)?.textContent || '{}');
    } catch {
      return {};
    }
  };
  const visible = (element) => !!element?.getClientRects().length;
  function gate() {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible);
    const text = (dialog || document.body).innerText;
    if (/Too many attempts|Слишком много попыток|Too many requests/i.test(text))
      return {
        code: 'TIKTOK_RATE_LIMIT',
        message: 'TikTok временно ограничил запросы. Повторите позже.',
      };
    if (
      /Verify to continue|Complete the puzzle|When is your birthday|Подтвердите, что вы человек|Перетащите.*пазл|Подтверждение личности|Введите шестизначный код/i.test(
        text,
      )
    )
      return {
        code: 'TIKTOK_BLOCKED',
        message: 'Завершите проверку в открытой вкладке TikTok, затем повторите сбор.',
      };
    return null;
  }
  function scroll(selector) {
    let element = document.querySelector(selector)?.parentElement;
    while (element && element !== document.body) {
      if (
        /auto|scroll/.test(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight + 10
      ) {
        element.scrollTop = element.scrollHeight;
        return;
      }
      element = element.parentElement;
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
  }
  globalThis.__eContentZenCommand = async (action) => {
    const message = { action };
    if (
      ![
        'identity',
        'snapshot',
        'scrollProfile',
        'openComments',
        'scrollComments',
        'replies',
      ].includes(message.action)
    )
      return;
    const blocked = gate();
    if (blocked) return { error: blocked };
    const data = json('__UNIVERSAL_DATA_FOR_REHYDRATION__'),
      scope = data.__DEFAULT_SCOPE__ || {};
    if (message.action === 'identity') {
      let user = scope['webapp.app-context']?.user;
      if (
        user &&
        (user.uid || user.userId || user.id || user.user_id_str) &&
        (user.uniqueId || user.unique_id || user.username)
      )
        return { user };
      try {
        const response = await fetch(
          'https://www.tiktok.com/passport/web/account/info/?aid=1988&app_language=en&app_name=tiktok_web',
          { credentials: 'include' },
        );
        const account = response.ok ? await response.json() : null;
        if (account?.message === 'success') user = account.data;
      } catch {}
      return { user: user || null };
    }
    if (message.action === 'snapshot') {
      const sigi = json('SIGI_STATE');
      return {
        items: scope['webapp.user-detail']?.itemList || Object.values(sigi.ItemModule || {}),
        video:
          scope['webapp.video-detail']?.itemInfo?.itemStruct ||
          Object.values(sigi.ItemModule || {})[0] ||
          null,
        emptyComments: /No comments yet|Пока нет комментариев|Комментариев пока нет/i.test(
          document.body.innerText,
        ),
      };
    }
    if (message.action === 'scrollProfile')
      scroll('[data-e2e="user-post-item-list"], [data-e2e="user-post-item"], #main-content-user');
    if (message.action === 'scrollComments')
      scroll('[data-e2e="comment-level-1"], [data-e2e="comment-item"], [data-e2e="comment-list"]');
    if (message.action === 'openComments') {
      const panel = [
        ...document.querySelectorAll(
          '[data-e2e="comment-level-1"], [data-e2e="comment-item"], [data-e2e="comment-list"]',
        ),
      ].find(visible);
      if (panel) return { opened: true, panel: true };
      const consent = [...document.querySelectorAll('button')].find(
        (el) =>
          visible(el) &&
          /^(Decline optional cookies|Reject optional cookies|Отклонить необязательные файлы cookie)$/i.test(
            el.textContent.trim(),
          ),
      );
      consent?.click();
      const button =
        [...document.querySelectorAll('button')].find(
          (el) =>
            visible(el) && /^(Comments|Комментарии)(?:\s*\(\d+\))?$/i.test(el.textContent.trim()),
        ) ||
        [
          ...document.querySelectorAll(
            '[data-e2e="comment-icon"], [data-e2e="browse-comment-count"]',
          ),
        ].find(visible);
      button?.click();
      return { opened: !!button };
    }
    if (message.action === 'replies') {
      const buttons = [...document.querySelectorAll('button, [role="button"], p, span')].filter(
        (el) =>
          visible(el) &&
          el.children.length === 0 &&
          /^(View \d+ (more )?repl|View replies|Посмотреть.*ответ|Показать.*ответ|Смотреть.*ответ)/i.test(
            el.textContent.trim(),
          ),
      );
      const button = buttons.find((el) => !el.dataset.ecOpened);
      if (button) {
        button.dataset.ecOpened = 'true';
        button.click();
      }
      return { opened: !!button };
    }
    return {};
  };
})();
