'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../rage-bait-hider.user.js');
const source = fs.readFileSync(path.join(__dirname, '../rage-bait-hider.user.js'), 'utf8');

function varint(n) {
  const out = []; n = BigInt(n);
  do { const byte = Number(n & 127n); n >>= 7n; out.push(byte | (n ? 128 : 0)); } while (n);
  return out;
}
function encodedDanmaku(entries) {
  return entries.flatMap(entry => {
    const text = [...Buffer.from(entry.text)];
    const body = [16, ...varint(entry.time * 1000), 24, entry.mode || 1, 40, ...varint(0xffffff), 58, ...varint(text.length), ...text];
    return [10, ...varint(body.length), ...body];
  });
}

test('one decision per item; the model sees the explicit target and common policy', () => {
  const request = core.buildRequest('测试视频', [
    { type: 'comment', text: '谢谢', parent: '教程' },
    { type: 'danmaku', text: '就这？' }
  ]);
  assert.equal(Object.keys(request.questions).length, 2);
  assert.equal(request.questions.item_0.type, 'noul');
  assert.match(request.questions.item_1.instructions, /state\.items\.item_1\.target_text/);
  assert.equal(request.state.items.item_0.parent_comment, '教程');
  assert.equal(request.state.items.item_1.target_text, '就这？');
});

test('fail closed for missing, malformed and boundary probabilities', () => {
  for (const probability of [undefined, null, NaN, Infinity, -1, 1.1, '0.01', 0.3, 0.9]) {
    assert.equal(core.shouldHide(probability, 0.3), true);
  }
  assert.equal(core.shouldHide(0, 0.3), false);
  assert.equal(core.shouldHide(0.29, 0.3), false);
});

test('protobuf decoder preserves Chinese text and timing; rejects truncated data', () => {
  const decoded = core.decodeDanmaku(Uint8Array.from(encodedDanmaku([{ time: 12.345, text: '谢谢分享😊', mode: 5 }])));
  assert.deepEqual(decoded, [{ time: 12.345, mode: 5, color: 0xffffff, text: '谢谢分享😊' }]);
  assert.throws(() => core.decodeDanmaku(Uint8Array.from([10, 20, 16])));
  assert.throws(() => core.decodeDanmaku(Uint8Array.from([0])));
});

test('imports plain, assignment and JSON keys without embedding secrets', () => {
  assert.equal(core.parseKey(' \uFEFFfixture-key '), 'fixture-key');
  assert.equal(core.parseKey('TYPESAFE_API_KEY="fixture-key"'), 'fixture-key');
  assert.equal(core.parseKey('{"apiKey":"fixture-key"}'), 'fixture-key');
  assert.throws(() => core.parseKey('several words'));
  assert.doesNotMatch(source, /fixture-key/);
});

let browser;
const browserEnabled = process.env.RBH_BROWSER_TESTS === '1';
before(async () => {
  if (!browserEnabled) return;
  const { chromium } = require(process.env.RBH_PLAYWRIGHT_PATH || 'playwright');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); });

const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>测试视频</title><style>
body{font-family:sans-serif;margin:30px}.bpx-player-video-area{position:relative;width:800px;height:450px;background:#15202c}video{width:100%;height:100%}.reply-item{padding:12px;border-bottom:1px solid #ccc}
</style></head><body><h1 class="video-title">测试视频</h1>
<div class="bpx-player-video-area"><div class="bpx-player-video-wrap"><video></video></div><div class="bpx-player-dm-wrap">原始恶意弹幕</div></div>
<div id="commentapp"><div class="reply-item" id="good"><div class="reply-content">谢谢分享</div></div><div class="reply-item" id="bad"><div class="reply-content">恶意评论，就这？</div></div></div>
<bili-comments id="modern"></bili-comments>
<script>
window.addModern = function(text, isReply = false) {
 const root = document.querySelector('#modern').shadowRoot || document.querySelector('#modern').attachShadow({mode:'open'});
 let thread = root.querySelector('bili-comment-thread-renderer');
 if(!thread){thread=document.createElement('bili-comment-thread-renderer');thread.attachShadow({mode:'open'});root.append(thread);}
 const item = document.createElement(isReply ? 'bili-comment-reply-renderer' : 'bili-comment-renderer');
 const inner = item.attachShadow({mode:'open'});const body=document.createElement('div');body.id=isReply?'main':'content';
 const rich=document.createElement('bili-rich-text');const r=rich.attachShadow({mode:'open'});const span=document.createElement('span');span.textContent=text;r.append(span);body.append(rich);inner.append(body);thread.shadowRoot.append(item);return item;
};
window.modernGood=addModern('这是正常的一级评论');window.modernBad=addModern('恶意回复',true);
Object.defineProperty(document.querySelector('video'),'currentTime',{configurable:true,get(){return window.fakeTime||0;}});
</script></body></html>`;

async function setup(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://www.bilibili.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }));
  const encoded = encodedDanmaku([{ time: 10, text: '这段讲得真好' }, { time: 10, text: '恶意弹幕' }]);
  await page.addInitScript(({ options, encoded }) => {
    window.unsafeWindow = window;
    window.__INITIAL_STATE__ = { videoData: { bvid: 'BV1xx411c7mD', aid: 1, cid: 2, duration: 100, title: '测试视频', pages: [{ page: 1, cid: 2, duration: 100 }] } };
    window.__requests = [];
    window.__apiStatus = options.apiStatus || 200;
    window.__apiDelay = options.apiDelay || 150;
    window.__stored = { 'rbh.settings.v1': { apiKey: options.noKey ? '' : 'fixture-key', enabled: true, comments: true, danmaku: options.danmaku || false, threshold: 0.3 } };
    window.GM_getValue = (key, fallback) => window.__stored[key] ?? fallback;
    window.GM_setValue = (key, value) => { window.__stored[key] = JSON.parse(JSON.stringify(value)); };
    window.GM_registerMenuCommand = () => {};
    const originalAttach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
      const result = originalAttach.call(this, init);
      if (this.dataset.rbhUi) window.__ui = result;
      return result;
    };
    window.GM_xmlhttpRequest = config => {
      const isJev = config.url.includes('api.typesafe.ai');
      const body = isJev ? JSON.parse(config.data) : null;
      window.__requests.push({ url: config.url, body });
      const timer = setTimeout(() => {
        if (isJev) {
          const answers = {};
          Object.entries(body.state.items).forEach(([id, item]) => {
            if (options.malformed && item.target_text.includes('谢谢')) return;
            answers[id] = { type: 'noul', noul: /恶意|就这/.test(item.target_text) ? 0.97 : 0.01 };
          });
          config.onload({ status: window.__apiStatus, responseText: JSON.stringify({ answers, usage: { input_tokens: 100 } }) });
        } else config.onload({ status: 200, response: new Uint8Array(encoded).buffer });
      }, isJev ? window.__apiDelay : 30);
      return { abort() { clearTimeout(timer); config.onabort?.(); } };
    };
  }, { options, encoded });
  await page.addInitScript({ content: source });
  await page.goto('https://www.bilibili.com/video/BV1xx411c7mD');
  return { page, errors };
}

test('browser: legacy and nested Shadow DOM comments stay hidden until classified; replies include parent', { skip: !browserEnabled }, async () => {
  const { page, errors } = await setup({ apiDelay: 700 });
  try {
    assert.equal(await page.locator('#good').isVisible(), false);
    await page.waitForFunction(() => document.querySelector('#good').dataset.rbhState === 'allowed');
    assert.equal(await page.locator('#good').isVisible(), true);
    assert.equal(await page.locator('#bad').isVisible(), false);
    await page.waitForFunction(() => window.modernGood.dataset.rbhState === 'allowed' && window.modernBad.dataset.rbhState === 'blocked');
    const reply = await page.evaluate(() => window.__requests.flatMap(r => Object.values(r.body?.state.items || {})).find(i => i.target_text === '恶意回复'));
    assert.equal(reply.parent_comment, '这是正常的一级评论');
    await page.evaluate(() => { window.late = addModern('恶意动态回复', true); });
    await page.waitForFunction(() => window.late.dataset.rbhState === 'blocked');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('browser: recycled DOM text is reclassified, not trusted by its old allowed flag', { skip: !browserEnabled }, async () => {
  const { page } = await setup();
  try {
    await page.waitForFunction(() => document.querySelector('#good').dataset.rbhState === 'allowed');
    await page.evaluate(() => { document.querySelector('#good .reply-content').textContent = '恶意替换内容'; });
    await page.waitForFunction(() => document.querySelector('#good').dataset.rbhState === 'pending');
    assert.equal(await page.locator('#good').isVisible(), false);
    await page.waitForFunction(() => document.querySelector('#good').dataset.rbhState === 'blocked');
  } finally { await page.close(); }
});

test('browser: auth failure stops new requests; comments remain hidden; pause restores them', { skip: !browserEnabled }, async () => {
  const { page } = await setup({ apiStatus: 401 });
  try {
    await page.waitForFunction(() => window.__ui?.querySelector('#status').textContent.includes('鉴权失败'));
    assert.equal(await page.locator('#good').isVisible(), false);
    const count = await page.evaluate(() => window.__requests.length);
    await page.waitForTimeout(1800);
    assert.equal(await page.evaluate(() => window.__requests.length), count);
    await page.evaluate(() => window.__ui.querySelector('#toggle').click());
    assert.equal(await page.locator('#good').isVisible(), true);
    assert.equal(await page.locator('#bad').isVisible(), true);
  } finally { await page.close(); }
});

test('browser: missing answer fails closed while valid answers are usable', { skip: !browserEnabled }, async () => {
  const { page } = await setup({ malformed: true });
  try {
    await page.waitForFunction(() => document.querySelector('#good').dataset.rbhState === 'error');
    assert.equal(await page.locator('#good').isVisible(), false);
    await page.waitForFunction(() => window.modernGood.dataset.rbhState === 'allowed');
  } finally { await page.close(); }
});

test('browser: no key means no API traffic and a visible setup prompt', { skip: !browserEnabled }, async () => {
  const { page } = await setup({ noKey: true });
  try {
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.__requests.length), 0);
    assert.equal(await page.evaluate(() => window.__ui.querySelector('#box').hidden), false);
    assert.equal(await page.locator('#good').isVisible(), false);
  } finally { await page.close(); }
});

test('browser: native danmaku hidden; only approved text reaches the replacement overlay', { skip: !browserEnabled }, async () => {
  const { page, errors } = await setup({ danmaku: true });
  try {
    await page.waitForFunction(() => window.__ui?.querySelector('#counts').textContent.includes('已判断 2'));
    assert.equal(await page.locator('.bpx-player-dm-wrap').isVisible(), false);
    await page.evaluate(() => { window.fakeTime = 9.9; });
    await page.waitForTimeout(100);
    await page.evaluate(() => { window.fakeTime = 10.1; });
    await page.waitForFunction(() => document.querySelector('[data-rbh-overlay]')?.textContent.includes('这段讲得真好'));
    assert.equal(await page.locator('[data-rbh-overlay]').textContent(), '这段讲得真好');
    await page.evaluate(() => { window.fakeTime = 20; });
    await page.waitForFunction(() => !document.querySelector('[data-rbh-overlay]').textContent);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('browser: changing policy invalidates scores; changing threshold reuses them', { skip: !browserEnabled }, async () => {
  const { page } = await setup();
  try {
    await page.waitForFunction(() => document.querySelector('#good').dataset.rbhState === 'allowed' && window.modernBad.dataset.rbhState === 'blocked');
    const count = await page.evaluate(() => window.__requests.length);
    await page.evaluate(() => { window.__ui.querySelector('#threshold').value = '0.5'; window.__ui.querySelector('#save').click(); });
    await page.waitForFunction(() => document.querySelector('#good').dataset.rbhState === 'allowed');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__requests.length), count);
    await page.evaluate(() => { window.__ui.querySelector('#policy').value = '隐藏所有嘲讽'; window.__ui.querySelector('#save').click(); });
    await page.waitForFunction(count => window.__requests.length > count, count);
  } finally { await page.close(); }
});
