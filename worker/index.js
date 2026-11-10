const OWNER = 'daniil179828';
const WINDOWS_URL = 'https://raw.githubusercontent.com/daniil179828/QWLEY-SHADE-install-/main/qwley-shade-launcher.exe';
const WINDOWS_NAME = 'qwley-shade-launcher.exe';
const SOURCES = {
  ios: { repo: 'ipaqwleyshade', extension: '.ipa' },
  android: { repo: 'apkqwleyshade', extension: '.apk' },
};
const CACHE_MS = 600_000;
const MAX_PROXY_BYTES = 90 * 1024 * 1024;
const UA = 'qwley-shade-download';
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

function missingBuild(extension) {
  const error = new Error('Сборка пока не загружена. Попробуйте позже.');
  error.status = 404;
  return error;
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

function mediaUrl(repo, revision, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://media.githubusercontent.com/media/${OWNER}/${repo}/${revision}/${encoded}`;
}

async function githubJson(fetchImpl, token, path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': UA,
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

async function lookupApi(repo, extension, fetchImpl, token) {
  const commit = await githubJson(fetchImpl, token, `${repo}/commits/HEAD`);
  if (!/^[a-f0-9]{40}$/.test(commit.sha) || !/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha)) throw new Error('Invalid commit');
  const tree = await githubJson(fetchImpl, token, `${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete repository tree');
  const file = selectBuild(tree.tree, extension);
  if (!file) throw missingBuild(extension);
  if (file.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid file path');
  return { url: mediaUrl(repo, commit.sha, file.path), name: file.path.split('/').pop() };
}

async function lookupHtml(repo, extension, fetchImpl) {
  const response = await fetchImpl(`https://github.com/${OWNER}/${repo}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub page: HTTP ${response.status}`);
  const html = await response.text();
  const pattern = new RegExp('"name":"([^"]*' + extension.replace('.', '\\.') + ')"', 'gi');
  const names = [...new Set([...html.matchAll(pattern)].map(match => match[1]))];
  if (names.length > 1) {
    const error = new Error('В репозитории несколько сборок. Оставьте один файл ' + extension + '.');
    error.status = 409;
    throw error;
  }
  if (!names.length) throw missingBuild(extension);
  return { url: mediaUrl(repo, 'main', names[0]), name: names[0] };
}

async function lookupCdn(repo, extension, fetchImpl) {
  const response = await fetchImpl(`https://data.jsdelivr.com/v1/packages/gh/${OWNER}/${repo}@main`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`jsDelivr: HTTP ${response.status}`);
  const data = await response.json();
  const files = (data.files || []).filter(file => file.type === 'file' && file.name.toLowerCase().endsWith(extension));
  if (files.length > 1) {
    const error = new Error('В репозитории несколько сборок. Оставьте один файл ' + extension + '.');
    error.status = 409;
    throw error;
  }
  if (!files.length) throw missingBuild(extension);
  return { url: mediaUrl(repo, 'main', files[0].name), name: files[0].name.split('/').pop() };
}

async function lookup(platform, fetchImpl, token) {
  const { repo, extension } = SOURCES[platform];
  const attempts = [
    { source: 'api', run: () => lookupApi(repo, extension, fetchImpl, token) },
    { source: 'html', run: () => lookupHtml(repo, extension, fetchImpl) },
    { source: 'cdn', run: () => lookupCdn(repo, extension, fetchImpl) },
  ];
  const failures = [];
  for (const attempt of attempts) {
    try {
      return { ...(await attempt.run()), source: attempt.source };
    } catch (error) {
      if (error.status === 409) throw error;
      failures.push(error);
    }
  }
  const notFound = failures.every(error => error.status === 404);
  const error = new Error(notFound ? 'Сборка пока не загружена. Попробуйте позже.' : 'Не удалось получить сборку с GitHub. Попробуйте позже.');
  if (notFound) error.status = 404;
  error.detail = failures.map(failure => failure.message).join('; ');
  throw error;
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
  const headers = { 'User-Agent': UA, Accept: '*/*' };
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
    const response = await serve(file.url, file.name, request, method);
    response.headers.set('X-Build-Source', file.source);
    return response;
  } catch (error) {
    console.error('GitHub download lookup failed:', error.message, error.detail || '');
    return json({
      error: error.status ? error.message : 'Не удалось получить сборку с GitHub. Попробуйте позже.',
      detail: error.detail || error.message,
    }, error.status || 502);
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/download' || path === '/api/download/') {
      return onRequest({ request, env });
    }
    return env.ASSETS?.fetch ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};
