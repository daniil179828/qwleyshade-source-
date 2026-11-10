const OWNER = 'daniil179828';
const WINDOWS_URL = 'https://raw.githubusercontent.com/daniil179828/QWLEY-SHADE-install-/main/qwley-shade-launcher.exe';
const WINDOWS_NAME = 'qwley-shade-launcher.exe';
const SOURCES = {
  ios: { repo: 'ipaqwleyshade', extension: '.ipa' },
  android: { repo: 'apkqwleyshade', extension: '.apk' },
};
const CACHE_MS = 600_000;
const MAX_PROXY_BYTES = 90 * 1024 * 1024;
const cache = new Map();

export function selectBuild(tree, extension) {
  const matches = tree.filter(file => file.type === 'blob' && file.path.toLowerCase().endsWith(extension));
  if (matches.length > 1) {
    const error = new Error('В репозитории несколько сборок. Оставьте один файл ' + extension + '.');
    error.status = 409;
    throw error;
  }
  return matches[0];
}

function json(data, status, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function githubJson(fetchImpl, token, path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'qwley-shade-download',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/repos/${OWNER}/${path}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status}`);
  return response.json();
}

async function lookup(platform, fetchImpl, token) {
  const { repo, extension } = SOURCES[platform];
  const commit = await githubJson(fetchImpl, token, `${repo}/commits/HEAD`);
  if (!/^[a-f0-9]{40}$/.test(commit.sha) || !/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha)) throw new Error('Invalid commit');
  const tree = await githubJson(fetchImpl, token, `${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete repository tree');
  const file = selectBuild(tree.tree, extension);
  if (!file) {
    const error = new Error('Сборка пока не загружена. Попробуйте позже.');
    error.status = 404;
    throw error;
  }
  if (file.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid file path');
  const encoded = file.path.split('/').map(encodeURIComponent).join('/');
  return {
    url: `https://media.githubusercontent.com/media/${OWNER}/${repo}/${commit.sha}/${encoded}`,
    name: file.path.split('/').pop(),
  };
}

async function resolve(platform, fetchImpl, token) {
  const entry = cache.get(platform);
  if (entry?.value && entry.expires > Date.now()) return entry.value;
  if (entry?.pending) return entry.pending;
  const pending = lookup(platform, fetchImpl, token);
  cache.set(platform, { ...(entry || {}), pending });
  try {
    const value = await pending;
    cache.set(platform, { value, expires: Date.now() + CACHE_MS });
    return value;
  } catch (error) {
    if (entry?.value) cache.set(platform, entry);
    else cache.delete(platform);
    throw error;
  }
}

async function serve(sourceUrl, name, request, method) {
  const range = request.headers.get('Range');
  const headers = { 'User-Agent': 'qwley-shade-download', Accept: '*/*' };
  if (range) headers.Range = range;
  let upstream = null;
  try {
    upstream = await fetch(sourceUrl, {
      method: method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow',
    });
  } catch {
    upstream = null;
  }
  if (!upstream || !upstream.ok) {
    if (!range) return new Response(null, { status: 302, headers: { Location: sourceUrl, 'Cache-Control': 'no-store' } });
    return json({ error: 'Не удалось получить сборку с GitHub. Попробуйте позже.' }, 502);
  }
  const length = Number(upstream.headers.get('content-length'));
  if (!range && (!Number.isFinite(length) || length > MAX_PROXY_BYTES)) {
    if (upstream.body) upstream.body.cancel();
    return new Response(null, { status: 302, headers: { Location: sourceUrl, 'Cache-Control': 'no-store' } });
  }
  const out = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': contentDisposition(name),
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  });
  const upstreamLength = upstream.headers.get('content-length');
  const upstreamRange = upstream.headers.get('content-range');
  if (upstreamLength) out.set('Content-Length', upstreamLength);
  if (upstreamRange) out.set('Content-Range', upstreamRange);
  if (method === 'HEAD' || !upstream.body) {
    if (upstream.body) upstream.body.cancel();
    return new Response(null, { status: upstream.status, headers: out });
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return json({ error: 'Метод не поддерживается.' }, 405, { Allow: 'GET, HEAD' });
  }
  const platform = new URL(request.url).searchParams.get('platform');
  if (platform === 'windows') return serve(WINDOWS_URL, WINDOWS_NAME, request, method);
  if (!platform || !Object.hasOwn(SOURCES, platform)) return json({ error: 'Неизвестная платформа.' }, 400);
  try {
    const file = await resolve(platform, fetch, env?.GITHUB_TOKEN);
    return await serve(file.url, file.name, request, method);
  } catch (error) {
    console.error('GitHub download lookup failed:', error.message);
    return json({ error: error.status ? error.message : 'Не удалось получить сборку с GitHub. Попробуйте позже.' }, error.status || 502);
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/download' || path === '/api/download/') {
      return onRequest({ request, env, waitUntil: () => {} });
    }
    return env.ASSETS?.fetch ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};
