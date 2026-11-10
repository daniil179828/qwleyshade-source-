import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, selectBuild } from '../public/_worker.js';

const SHA = 'c'.repeat(40);
const TREE = 'd'.repeat(40);
const file = path => ({ type: 'blob', path });

function github(url) {
  if (url.includes('/commits/')) return { sha: SHA, commit: { tree: { sha: TREE } } };
  return { tree: [file('builds/app.ipa'), file('apk/app.apk')], truncated: false };
}

function stub(routes) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    for (const [match, handler] of routes) if (target.includes(match)) return handler(target, options);
    throw new Error('Unexpected fetch: ' + target);
  };
  return () => { globalThis.fetch = original; };
}

function binary(size, type = 'application/octet-stream') {
  return new Response(new Uint8Array(size), { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size) } });
}

async function call(platform, method = 'GET') {
  const url = platform === null ? 'https://qwleyshade.pro/api/download' : `https://qwleyshade.pro/api/download?platform=${platform}`;
  return onRequest({ request: new Request(url, { method }), env: {} });
}

test('selects the single build by extension', () => {
  assert.equal(selectBuild([file('a.md'), file('x.IPA')], '.ipa').path, 'x.IPA');
});

test('ios downloads with a real .ipa filename', async () => {
  const restore = stub([
    ['api.github.com', url => new Response(JSON.stringify(github(url)), { status: 200 })],
    ['media.githubusercontent.com', () => binary(2048)],
  ]);
  try {
    const response = await call('ios');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
    assert.match(response.headers.get('Content-Disposition'), /filename="app\.ipa"/);
    assert.equal((await response.arrayBuffer()).byteLength, 2048);
  } finally {
    restore();
  }
});

test('android streams the apk from the pinned media url', async () => {
  let media = '';
  const restore = stub([
    ['api.github.com', url => new Response(JSON.stringify(github(url)), { status: 200 })],
    ['media.githubusercontent.com', url => { media = url; return binary(1024); }],
  ]);
  try {
    const response = await call('android');
    assert.equal(response.status, 200);
    assert.match(media, new RegExp(`media/daniil179828/apkqwleyshade/${SHA}/apk/app\\.apk$`));
    assert.match(response.headers.get('Content-Disposition'), /filename="app\.apk"/);
  } finally {
    restore();
  }
});

test('windows launcher keeps its .exe name', async () => {
  const restore = stub([['raw.githubusercontent.com', () => binary(512, 'application/octet-stream')]]);
  try {
    const response = await call('windows');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Disposition'), /filename="qwley-shade-launcher\.exe"/);
  } finally {
    restore();
  }
});

test('huge builds fall back to a direct redirect with the original filename', async () => {
  const restore = stub([
    ['api.github.com', url => new Response(JSON.stringify(github(url)), { status: 200 })],
    ['media.githubusercontent.com', () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': String(120 * 1024 * 1024) }),
      body: { cancel() {} },
    })],
  ]);
  try {
    const response = await call('ios');
    assert.equal(response.status, 302);
    assert.match(response.headers.get('Location'), /builds\/app\.ipa$/);
  } finally {
    restore();
  }
});

test('HEAD returns headers without a body', async () => {
  const restore = stub([['raw.githubusercontent.com', () => binary(256)]]);
  try {
    const response = await call('windows', 'HEAD');
    assert.equal(response.status, 200);
    assert.equal(response.body, null);
    assert.equal(response.headers.get('Content-Length'), '256');
  } finally {
    restore();
  }
});

test('range requests are proxied', async () => {
  const restore = stub([['raw.githubusercontent.com', (url, options) => {
    assert.equal(options.headers.Range, 'bytes=0-9');
    return new Response(new Uint8Array(10), { status: 206, headers: { 'Content-Range': 'bytes 0-9/512', 'Content-Length': '10' } });
  }]]);
  try {
    const response = await onRequest({ request: new Request('https://qwleyshade.pro/api/download?platform=windows', { headers: { Range: 'bytes=0-9' } }), env: {} });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), 'bytes 0-9/512');
  } finally {
    restore();
  }
});

test('bad platform, bad method and failed upstream', async () => {
  const fresh = await import('../public/_worker.js?missing-build');
  const restore = stub([['api.github.com', url => new Response(JSON.stringify(url.includes('/commits/') ? { sha: SHA, commit: { tree: { sha: TREE } } } : { tree: [file('readme.md')], truncated: false }), { status: 200 })]]);
  try {
    assert.equal((await call('linux')).status, 400);
    assert.equal((await call(null)).status, 400);
    const post = await call('ios', 'POST');
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('Allow'), 'GET, HEAD');
    const missing = await fresh.onRequest({ request: new Request('https://qwleyshade.pro/api/download?platform=ios'), env: {} });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, 'Сборка пока не загружена. Попробуйте позже.');
  } finally {
    restore();
  }
});

test('unknown platform never reaches GitHub', async () => {
  const response = await call('constructor');
  assert.equal(response.status, 400);
});

test('worker serves the download route and passes the rest to static assets', async () => {
  const worker = (await import('../public/_worker.js?router')).default;
  const assets = [];
  const env = { ASSETS: { fetch: request => { assets.push(new URL(request.url).pathname); return new Response('asset'); } } };
  const page = await worker.fetch(new Request('https://qwleyshade.pro/assets/logo.png'), env);
  assert.equal(await page.text(), 'asset');
  const bad = await worker.fetch(new Request('https://qwleyshade.pro/api/download?platform=linux'), env);
  assert.equal(bad.status, 400);
  assert.deepEqual(assets, ['/assets/logo.png']);
});

test('assets referenced by the pages exist locally', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('qwleyshade.vercel.app'));
  for (const match of html.matchAll(/assets\/[A-Za-z0-9._-]+/g)) {
    await readFile(new URL('../public/' + match[0], import.meta.url));
  }
});

