import { list } from '@vercel/blob';

const TYPES = {
  ipa: { prefix: 'ipa/', extension: '.ipa' },
  apk: { prefix: 'apk/', extension: '.apk' },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end('Method not allowed');
  }
  const query = new URL(req.url, 'https://localhost').searchParams;
  const config = TYPES[query.get('type')];
  if (!config) return res.status(400).end('Use type=ipa or type=apk');
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(503).end('Download storage is not configured');

  try {
    let cursor;
    let latest;
    do {
      const page = await list({ token, prefix: config.prefix, limit: 1000, cursor });
      for (const blob of page.blobs) {
        if (!blob.pathname.startsWith(config.prefix) ||
            !blob.pathname.toLowerCase().endsWith(config.extension)) continue;
        if (!latest || new Date(blob.uploadedAt).getTime() > new Date(latest.uploadedAt).getTime()) {
          latest = blob;
        }
      }
      cursor = page.hasMore ? page.cursor : undefined;
      if (page.hasMore && !cursor) throw new Error('Missing pagination cursor');
    } while (cursor);

    if (!latest) return res.status(404).end('No matching file in this folder');
    if (query.get('meta') === '1') {
      return res.status(200).json({ filename: latest.pathname.split('/').pop(), size: latest.size });
    }
    // Redirect directly to Blob: the large file never passes through a Function.
    const target = new URL(latest.downloadUrl || latest.url);
    target.searchParams.set('download', '1');
    res.setHeader('Location', target.href);
    return res.status(302).end();
  } catch {
    // Never return storage credentials or raw SDK errors to visitors.
    return res.status(502).end('Download temporarily unavailable. Please try again.');
  }
}
