const WINDOWS_URL = 'https://raw.githubusercontent.com/daniil179828/QWLEY-SHADE-install-/main/qwley-shade-launcher.exe';
const OWNER = 'daniil179828';
const SOURCES = {
  ios: { repo: 'ipaqwleyshade', extension: '.ipa' },
  android: { repo: 'apkqwleyshade', extension: '.apk' },
};
const CACHE_MS = 30_000;

// Never guess from a filename/version number. Keep one build per repository.
export function selectBuild(tree, extension) {
  const matches = tree.filter(file => file.type === 'blob' && file.path.toLowerCase().endsWith(extension));
  if (matches.length > 1) {
    const error = new Error('В репозитории несколько сборок. Оставьте один файл ' + extension + '.');
    error.status = 409;
    throw error;
  }
  return matches[0];
}

export function makeHandler(fetchFiles = globalThis.fetch, env = process.env, now = Date.now) {
  const cache = new Map();
  async function github(path) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'qwley-shade-download', 'X-GitHub-Api-Version': '2022-11-28' };
    // Optional; sent only to api.github.com, never to the download URL/browser.
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
    const response = await fetchFiles(`https://api.github.com/repos/${OWNER}/${path}`, {
      headers, signal: AbortSignal.timeout(10_000), cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status}`);
    return response.json();
  }
  async function resolve(platform) {
    const { repo, extension } = SOURCES[platform];
    // HEAD follows the default branch, even if it is renamed from main.
    const commit = await github(`${repo}/commits/HEAD`);
    if (!/^[a-f0-9]{40}$/.test(commit.sha) || !/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha)) throw new Error('Invalid commit');
    const tree = await github(`${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`);
    if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete repository tree');
    const file = selectBuild(tree.tree, extension);
    if (!file) {
      const error = new Error('Сборка пока не загружена. Попробуйте позже.');
      error.status = 404;
      throw error;
    }
    if (file.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid file path');
    const path = file.path.split('/').map(encodeURIComponent).join('/');
    // github.com/raw resolves both ordinary Git files and Git LFS objects.
    // raw.githubusercontent.com alone can return a 134-byte LFS pointer instead.
    // Pin to this commit so a concurrent rename cannot change the resolved file.
    return `https://github.com/${OWNER}/${repo}/raw/${commit.sha}/${path}?download=1`;
  }
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).json({ error: 'Метод не поддерживается.' });
    }
    const platform = req.query?.platform;
    if (platform === 'windows') return res.redirect(302, WINDOWS_URL);
    if (typeof platform !== 'string' || !Object.hasOwn(SOURCES, platform)) return res.status(400).json({ error: 'Неизвестная платформа.' });
    try {
      let entry = cache.get(platform);
      if (!entry || entry.expires <= now()) {
        entry = { promise: resolve(platform), expires: now() + CACHE_MS };
        cache.set(platform, entry);
      }
      const url = await entry.promise;
      return res.redirect(302, url);
    } catch (error) {
      cache.delete(platform);
      console.error('GitHub download lookup failed:', error.message);
      return res.status(error.status || 502).json({
        error: error.status ? error.message : 'Не удалось получить сборку с GitHub. Попробуйте позже.',
      });
    }
  };
}
export default makeHandler();
