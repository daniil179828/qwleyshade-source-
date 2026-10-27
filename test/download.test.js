import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeHandler, selectBuild } from '../api/download.js';
const SHA = 'a'.repeat(40), TREE = 'b'.repeat(40);
const file = path => ({ type: 'blob', path });
function response() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(data) { this.body = data; return this; }, redirect(s, u) { this.code = s; this.location = u; return this; } }; }
function upstream(tree, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.includes('/commits/') ? { sha: SHA, commit: { tree: { sha: TREE } } } : { tree, truncated: false } };
  };
}
async function run(handler, platform = 'ios', method = 'GET') { const res = response(); await handler({ method, query: { platform } }, res); return res; }
test('selects by extension regardless of name, case or folder', () => {
  assert.equal(selectBuild([file('README.md'), file('releases/renamed.IPA'), { type: 'tree', path: 'folder.ipa' }], '.ipa').path, 'releases/renamed.IPA');
});
test('ambiguous repository is not silently resolved to an arbitrary build', () => {
  assert.throws(() => selectBuild([file('old.ipa'), file('new.ipa')], '.ipa'), { status: 409 });
});
for (const [platform, repo, path] of [['ios', 'ipaqwleyshade', 'builds/new version #2.IPA'], ['android', 'apkqwleyshade', 'папка/renamed.apk']]) {
  test(`${platform}: repository, encoded path and immutable GitHub/LFS download URL`, async () => {
    const calls = [], res = await run(makeHandler(upstream([file(path)], calls), {}), platform);
    assert.equal(res.code, 302);
    assert.equal(res.location, `https://github.com/daniil179828/${repo}/raw/${SHA}/${path.split('/').map(encodeURIComponent).join('/')}?download=1`);
    assert.match(calls[0].url, new RegExp(`/${repo}/commits/HEAD$`));
    assert.match(calls[1].url, new RegExp(`/git/trees/${TREE}\\?recursive=1$`));
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  });
}
test('new filename is discovered after the 30-second lookup cache expires', async () => {
  let time = 0, path = 'first.ipa';
  const calls = [];
  const handler = makeHandler((...args) => upstream([file(path)], calls)(...args), {}, () => time);
  assert.match((await run(handler)).location, /first\.ipa/);
  path = 'second.ipa';
  await run(handler);
  assert.equal(calls.length, 2);
  time = 30_001;
  assert.match((await run(handler)).location, /second\.ipa/);
  assert.equal(calls.length, 4);
});
test('concurrent requests share lookup', async () => {
  const calls = [], handler = makeHandler(upstream([file('one.ipa')], calls), {});
  const results = await Promise.all([run(handler), run(handler)]);
  assert.equal(calls.length, 2);
  assert.ok(results.every(r => r.code === 302));
});
test('optional token sent only in server-side API requests', async () => {
  const calls = [], res = await run(makeHandler(upstream([file('app.ipa')], calls), { GITHUB_TOKEN: 'test-secret' }));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-secret');
  assert.ok(!res.location.includes('test-secret'));
});
test('public repository works without any token', async () => {
  const calls = [], res = await run(makeHandler(upstream([file('app.ipa')], calls), {}));
  assert.equal(res.code, 302);
  assert.equal(calls[0].options.headers.Authorization, undefined);
});
test('Windows unchanged and no GitHub API lookup', async () => {
  const res = await run(makeHandler(() => { throw new Error('Unexpected lookup'); }), 'windows');
  assert.equal(res.location, 'https://raw.githubusercontent.com/daniil179828/QWLEY-SHADE-install-/main/qwley-shade-launcher.exe');
});
test('HEAD is accepted', async () => assert.equal((await run(makeHandler(upstream([file('a.ipa')]), {}), 'ios', 'HEAD')).code, 302));
test('unsupported methods and platforms do not call upstream', async () => {
  const handler = makeHandler(() => { throw new Error('Unexpected lookup'); });
  for (const platform of ['bad', '__proto__', 'constructor', ['ios'], undefined]) assert.equal((await run(handler, platform === undefined ? null : platform)).code, 400);
  const res = await run(handler, 'ios', 'POST');
  assert.equal(res.code, 405); assert.equal(res.headers.Allow, 'GET, HEAD');
});
test('missing file, multiple builds, truncated tree, upstream errors and malformed commit', async () => {
  for (const [fetcher, code] of [
    [upstream([file('README.md')]), 404],
    [upstream([file('a.ipa'), file('b.ipa')]), 409],
    [async url => ({ ok: true, json: async () => url.includes('/commits/') ? { sha: SHA, commit: { tree: { sha: TREE } } } : { tree: [file('a.ipa')], truncated: true } }), 502],
    [async () => ({ ok: false, status: 403 }), 502],
    [async () => { throw new Error('timeout'); }, 502],
    [async () => ({ ok: true, json: async () => ({ sha: 'invalid' }) }), 502],
  ]) assert.equal((await run(makeHandler(fetcher, {}))).code, code);
});
test('failed lookups are not cached', async () => {
  let fail = true;
  const handler = makeHandler((...args) => { if (fail) throw new Error('network error'); return upstream([file('recovered.ipa')])(...args); }, {});
  assert.equal((await run(handler)).code, 502);
  fail = false;
  assert.equal((await run(handler)).code, 302);
});
test('all mobile links replaced in both identical pages; no Blob dependency', async () => {
  const a = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const b = await readFile(new URL('../public/qwleyshade1.html', import.meta.url), 'utf8');
  assert.equal(a, b);
  assert.ok(!a.includes('blob.vercel-storage.com'));
  assert.equal((a.match(/href="\/api\/download\?platform=ios"/g) || []).length, 4);
  assert.equal((a.match(/href="\/api\/download\?platform=android"/g) || []).length, 3);
  const pkg = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  assert.ok(!pkg.includes('@vercel/blob'));
});
