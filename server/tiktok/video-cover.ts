import { videoPageCover } from './parser.ts';

export async function publicVideoCover(url: string, id: string) {
  const address = URL.parse(url);
  if (
    address?.origin !== 'https://www.tiktok.com' ||
    !/^\/@[\w.]+\/video\/\d+$/.test(address.pathname) ||
    !address.pathname.endsWith('/' + id)
  ) {
    return;
  }

  try {
    const response = await fetch(address.origin + address.pathname, {
      redirect: 'error',
      signal: AbortSignal.timeout(6000),
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) return;
    const html = await response.text();
    const script = html.match(
      /<script\b[^>]*\bid=["'](?:__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE)["'][^>]*>([\s\S]*?)<\/script>/i,
    );
    return script && videoPageCover(JSON.parse(script[1]), id);
  } catch {
    return;
  }
}
