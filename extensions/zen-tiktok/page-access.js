globalThis.EContentPage = {
  async read(browser, tabId, action, check, wait) {
    const actions = [
      'identity',
      'snapshot',
      'scrollProfile',
      'openComments',
      'scrollComments',
      'replies',
    ];
    if (!actions.includes(action)) throw Error('Неизвестное действие чтения TikTok.');
    if (!(await browser.permissions.contains({ origins: ['https://www.tiktok.com/*'] }))) {
      const error = Error('Разрешите расширению доступ к TikTok в настройках дополнения Zen.');
      error.code = 'ZEN_PERMISSION';
      throw error;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      check();
      try {
        const tab = await browser.tabs.get(tabId);
        if (!tab.url?.startsWith('https://www.tiktok.com/')) throw Error('Frame not ready');
        await browser.tabs.executeScript(tabId, {
          file: '/content.js',
          frameId: 0,
          runAt: 'document_idle',
        });
        const result = await browser.tabs.executeScript(tabId, {
          code: 'globalThis.__eContentZenCommand(' + JSON.stringify(action) + ')',
          frameId: 0,
          runAt: 'document_idle',
        });
        check();
        return result[0] ?? {};
      } catch (error) {
        check();
        if (
          !/Missing host permission|Receiving end does not exist|Could not establish connection|Frame.*(?:ready|found|removed|detached)|document.*(?:unloaded|changed)|__eContentZenCommand.*not a function/i.test(
            error.message,
          )
        )
          throw error;
        if (attempt === 2) {
          const failure = Error(
            'Не удалось прочитать вкладку TikTok после перехода. Проверьте доступ расширения к TikTok и повторите проверку аккаунта.',
          );
          failure.code = 'ZEN_PAGE_ACCESS';
          throw failure;
        }
        await wait(250 * (attempt + 1));
      }
    }
  },
};
