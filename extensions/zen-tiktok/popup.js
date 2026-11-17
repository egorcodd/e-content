const $ = (id) => document.getElementById(id);
async function status() {
  const state = await browser.runtime.sendMessage({ type: 'status' });
  $('version').textContent = state.version;
  document.body.dataset.online = String(state.online);
  $('status').textContent = state.running
    ? 'Сбор выполняется в отдельной вкладке TikTok'
    : state.online
      ? 'Zen подключён к цеху'
      : state.paired
        ? 'Локальный e-content недоступен'
        : 'Подключите расширение к локальному e-content';
  $('pair').hidden = state.paired;
  $('connected').hidden = !state.paired;
  if (state.error) $('error').textContent = state.error;
}
$('pair').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('error').textContent = '';
  const code = $('code').value.replace(/[\s-]/g, '');
  if (!/^[A-F\d]{12}$/i.test(code)) {
    $('error').textContent = 'Введите 12 символов кода из e-content.';
    return;
  }
  $('submit').disabled = true;
  try {
    const result = await browser.runtime.sendMessage({ type: 'pair', code });
    if (result.error) throw Error(result.error);
    $('code').value = '';
    await status();
  } catch (error) {
    $('error').textContent = error.message;
  } finally {
    $('submit').disabled = false;
  }
});
$('open').addEventListener('click', () => browser.tabs.create({ url: 'http://127.0.0.1:5186/' }));
$('forget').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'forget' });
  await status();
});
void status();
setInterval(() => void status(), 2000);
