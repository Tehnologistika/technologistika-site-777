import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import http from 'node:http';

const origin = 'https://xn--c1adkkjgb0abiz.xn--p1ai';
const local = 'http://127.0.0.1:41873';
const paths = ['/', '/services', '/services/avtovozy', '/about', '/contacts'];
let server;
before(async () => {
  server = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: '41873', TELEGRAM_BOT_TOKEN: '', TELEGRAM_LEADS_CHAT_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 10000);
    server.once('error', reject);
    server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    server.once('exit', code => reject(new Error(`Server exited: ${code}`)));
  });
});
after(() => server?.kill());

test('each public URL returns crawlable, distinct HTML and its canonical URL', async () => {
  const titles = new Set();
  for (const pathname of paths) {
    const response = await fetch(local + pathname);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes(`rel="canonical" href="${origin + pathname}"`), pathname);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
    assert.match(html, /<div id="root" class="prerendered">.+?<h1[\s>]/s);
    assert.match(html, /content="index, follow"/);
    assert.doesNotMatch(html, /%VITE_ANALYTICS_/);
    assert.doesNotMatch(html, /https:\/\/technologistika\.online/);
    titles.add(html.match(/<title>(.*?)<\/title>/s)[1]);
  }
  assert.equal(titles.size, paths.length);
});

test('robots and XML sitemap list the five canonical pages', async () => {
  const robots = await fetch(local + '/robots.txt').then(r => r.text());
  assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
  assert.doesNotMatch(robots, /Disallow:\s*\//);
  const response = await fetch(local + '/sitemap.xml');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /xml/);
  const xml = await response.text();
  assert.match(xml, /^<\?xml/);
  assert.deepEqual([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]), paths.map(p => origin + p));
});

test('www and alternate route spellings redirect with path and query intact', async () => {
  const www = await new Promise((resolve, reject) => {
    const request = http.get(local + '/services?utm_source=check', { headers: { Host: 'www.xn--c1adkkjgb0abiz.xn--p1ai' } }, response => { response.resume(); resolve(response); });
    request.on('error', reject);
  });
  assert.equal(www.statusCode, 301);
  assert.equal(www.headers.location, origin + '/services?utm_source=check');
  for (const [from, to] of [['/services/', '/services'], ['/index.html', '/'], ['/services/index.html?x=1', '/services?x=1']]) {
    const response = await fetch(local + from, { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), to);
  }
});

test('unknown pages and missing files return 404, noindex, and no canonical', async () => {
  for (const pathname of ['/not-a-page', '/missing.js', '/404', '/404.html']) {
    const response = await fetch(local + pathname);
    assert.equal(response.status, 404);
    const html = await response.text();
    assert.match(html, /content="noindex, follow"/);
    assert.doesNotMatch(html, /rel="canonical"/);
  }
});

test('lead endpoint still validates locally without sending a real lead', async () => {
  const response = await fetch(local + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).ok, false);
  const valid = await fetch(local + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Москва', to: 'Краснодар', carModel: 'Test', name: 'Local test', phone: '+70000000000' }) });
  assert.equal(valid.status, 500);
  assert.equal((await valid.json()).ok, false);
});
