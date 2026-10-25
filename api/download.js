import { list } from '@vercel/blob';

const STORE_HOST = 'zwmjilqpm64npnwg.public.blob.vercel-storage.com';
const WINDOWS_URL = 'https://raw.githubusercontent.com/daniil179828/QWLEY-SHADE-install-/main/qwley-shade-launcher.exe';

export function selectNewest(blobs, extension) {
  return blobs.filter(blob => blob.pathname.toLowerCase().endsWith(extension))
    .filter(blob => { try { const u = new URL(blob.url); return u.protocol === 'https:' && u.hostname === STORE_HOST; } catch { return false; } })
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime() || b.pathname.localeCompare(a.pathname))[0];
}

export function makeHandler(listFiles = list, env = process.env) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).json({error: 'Метод не поддерживается.'}); }
    const platform = req.query.platform;
    if (platform === 'windows') return res.redirect(302, WINDOWS_URL);
    if (!['ios', 'android'].includes(platform)) return res.status(400).json({error: 'Неизвестная платформа.'});
    if (!env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({error: 'Хранилище ещё не подключено. Свяжитесь с владельцем сайта.'});
    // The supplied iOS file is under ipa/. Both folder names are supported.
    const prefixes = platform === 'ios' ? ['ios/', 'ipa/'] : ['apk/', 'android/'];
    try {
      const groups = await Promise.all(prefixes.map(async prefix => {
        const files = []; let cursor;
        do {
          const page = await listFiles({prefix, limit: 1000, cursor, token: env.BLOB_READ_WRITE_TOKEN});
          files.push(...page.blobs);
          cursor = page.hasMore ? page.cursor : undefined;
          if (page.hasMore && !cursor) throw new Error('Missing pagination cursor');
        } while (cursor);
        return files;
      }));
      const file = selectNewest(groups.flat(), platform === 'ios' ? '.ipa' : '.apk');
      if (!file) return res.status(404).json({error: 'Сборка пока не загружена. Попробуйте позже.'});
      // Vercel Blob's download query sets Content-Disposition: attachment.
      const target = new URL(file.url);
      target.searchParams.set('download', '1');
      return res.redirect(302, target.href);
    } catch (error) {
      console.error('Blob download lookup failed:', error.message);
      return res.status(502).json({error: 'Не удалось получить сборку. Попробуйте позже.'});
    }
  };
}
export default makeHandler();
