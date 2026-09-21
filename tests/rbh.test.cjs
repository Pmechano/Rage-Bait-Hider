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

test('view metadata defines segment count, including closed/empty/invalid responses', () => {
  // DmWebViewReply.dmSge (field 4), DmSegConfig.total (field 2).
  assert.deepEqual(core.decodeDanmakuView(Uint8Array.from([34, 2, 16, 3])), { total: 3, closed: false });
  assert.deepEqual(core.decodeDanmakuView(Uint8Array.from([34, 2, 16, 0])), { total: 0, closed: false });
  assert.deepEqual(core.decodeDanmakuView(Uint8Array.from([8, 1])), { total: 0, closed: true });
  assert.throws(() => core.decodeDanmakuView(Uint8Array.from([])));
  assert.throws(() => core.decodeDanmakuView(Uint8Array.from([34, 8, 16])));
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
<div class="bpx-player-video-area"><div class="bpx-player-video-wrap"><video></video></div>
 <div class="bpx-player-dm-wrap"><div class="bpx-player-row-dm-wrap">
  <div class="native-wrapper"><div id="native-good" class="bili-danmaku-x-dm" style="font-size:28px;transform:translateX(123px);opacity:0.7">这段讲得真好</div>
  <div id="native-bad" class="b-danmaku">恶意弹幕</div></div>
  <div id="native-unknown">尚未适配的文字</div>
 </div></div><div class="bpx-player-bas-dm-wrap" id="native-special">特殊弹幕</div>
</div>
<div id="commentapp"><div class="reply-item" id="good"><span class="user-name">正常用户</span><div class="reply-content">谢谢分享</div></div><div class="reply-item" id="bad"><span class="user-name">另一位用户</span><div class="reply-content">恶意评论，就这？</div></div></div>
<bili-comments id="modern"></bili-comments>
<script>
window.addModern = function(text, isReply = false) {
 const root = document.querySelector('#modern').shadowRoot || document.querySelector('#modern').attachShadow({mode:'open'});
 let thread = root.querySelector('bili-comment-thread-renderer');
 if(!thread){thread=document.createElement('bili-comment-thread-renderer');thread.attachShadow({mode:'open'});root.append(thread);}
 const item = document.createElement(isReply ? 'bili-comment-reply-renderer' : 'bili-comment-renderer');
 const inner = item.attachShadow({mode:'open'});const profile=document.createElement('bili-user-profile');profile.attachShadow({mode:'open'}).innerHTML='<span id="name">昵称</span>';inner.append(profile);const body=document.createElement('div');body.id=isReply?'main':'content';
 const rich=document.createElement('bili-rich-text');const r=rich.attachShadow({mode:'open'});const span=document.createElement('span');span.textContent=text;r.append(span);body.append(rich);inner.append(body);thread.shadowRoot.append(item);return item;
};
window.modernGood=addModern('这是正常的一级评论');window.modernBad=addModern('恶意回复',true);
Object.defineProperty(document.querySelector('video'),'currentTime',{configurable:true,get(){return window.fakeTime||0;}});
window.effectiveOpacity=function(el){let opacity=1;for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(style.visibility==='hidden'||style.display==='none')return 0;opacity*=Number(style.opacity);}return opacity;};
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
        } else if (config.url.includes('/dm/web/view')) {
          config.onload({ status: options.viewStatus || 200, response: new Uint8Array([34, 2, 16, options.segments || 1]).buffer });
        } else config.onload({ status: 200, response: new Uint8Array(encoded).buffer });
      }, isJev ? window.__apiDelay : 30);
      return { abort() { clearTimeout(timer); config.onabort?.(); } };
    };
  }, { options, encoded });
  await page.addInitScript({ content: source });
  await page.goto('https://www.bilibili.com/video/BV1xx411c7mD');
  return { page, errors };
}

test('browser: three emotes bypass Jev for text, image alt and native danmaku', { skip: !browserEnabled }, async () => {
  const { page, errors } = await setup({ danmaku: true });
  try {
    await page.waitForFunction(() => document.querySelector('#good').dataset.rbhState === 'allowed');
    await page.evaluate(() => {
      for (const [index, emote] of ['[星星眼]', '[呲牙]', '[喜极而泣]'].entries()) {
        const comment = document.createElement('div'); comment.className = 'reply-item'; comment.id = `emote-${index}`;
        comment.innerHTML = `<span class="user-name">用户</span><div class="reply-content">正常文字<img alt="${emote}"></div>`;
        document.querySelector('#commentapp').append(comment);
        const dm = document.createElement('div'); dm.className = 'b-danmaku'; dm.id = `dm-emote-${index}`; dm.textContent = `正常弹幕${emote}`;
        document.querySelector('.native-wrapper').append(dm);
      }
      document.querySelector('#good .reply-content').textContent = '谢谢分享[呲牙]';
      window.modernGood.shadowRoot.querySelector('bili-rich-text').shadowRoot.querySelector('span').textContent = '一级评论[星星眼]';
    });
    await page.waitForFunction(() => [0, 1, 2].every(i => document.querySelector(`#emote-${i}`).dataset.rbhState === 'blocked' && document.querySelector(`#dm-emote-${i}`).dataset.rbhDm === 'hidden'));
    await page.waitForFunction(() => window.modernGood.dataset.rbhState === 'blocked' && document.querySelector('#good').dataset.rbhState === 'blocked');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#good').isVisible(), false);
    const leaked = await page.evaluate(() => window.__requests.flatMap(r => Object.values(r.body?.state.items || {})).filter(item => /\[(星星眼|呲牙|喜极而泣)\]/.test(item.target_text + item.parent_comment)));
    assert.deepEqual(leaked, []);
    await page.evaluate(() => { window.__ui.querySelector('#history-button').click(); });
    assert.match(await page.evaluate(() => window.__ui.querySelector('#history').textContent), /表情规则/);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('browser: blocked roots hide replies and expand controls in legacy and Shadow DOM threads', { skip: !browserEnabled }, async () => {
  const { page, errors } = await setup();
  try {
    await page.waitForFunction(() => window.modernGood.dataset.rbhState === 'allowed');
    await page.evaluate(() => {
      const legacy = document.createElement('div'); legacy.id = 'legacy-child'; legacy.className = 'sub-reply-item';
      legacy.innerHTML = '<span class="sub-user-name">回复者</span><div class="reply-content">正常的楼中回复</div>';
      document.querySelector('#bad').append(legacy);
      const expand = document.createElement('button'); expand.id = 'legacy-expand'; expand.textContent = '共 5 条回复，点击查看'; document.querySelector('#bad').append(expand);
      window.safeReply = addModern('正常回复需要随主评论隐藏', true);
      window.modernExpand = document.createElement('button'); window.modernExpand.textContent = '共 8 条回复，点击查看';
      window.modernGood.getRootNode().append(window.modernExpand);
    });
    await page.waitForFunction(() => window.safeReply.dataset.rbhState === 'allowed' && document.querySelector('#legacy-child').dataset.rbhState === 'allowed');
    assert.equal(await page.locator('#legacy-child').isVisible(), false);
    assert.equal(await page.locator('#legacy-expand').isVisible(), false);
    const hiddenBeforePaint = await page.evaluate(async () => {
      window.modernGood.shadowRoot.querySelector('bili-rich-text').shadowRoot.querySelector('span').textContent = '恶意主评论';
      await new Promise(requestAnimationFrame);
      return getComputedStyle(window.modernGood.getRootNode().host).display === 'none';
    });
    assert.equal(hiddenBeforePaint, true);
    await page.waitForFunction(() => window.modernGood.dataset.rbhState === 'blocked' && window.safeReply.dataset.rbhState === 'allowed');
    assert.equal(await page.locator('bili-comment-thread-renderer button').isVisible(), false);
    assert.equal(await page.evaluate(() => window.safeReply.getBoundingClientRect().height), 0);
    await page.evaluate(() => { window.lateSafeReply = addModern('后来加载的正常回复', true); });
    await page.waitForFunction(() => window.lateSafeReply.dataset.rbhState === 'allowed');
    assert.equal(await page.evaluate(() => window.lateSafeReply.getBoundingClientRect().height), 0);
    // An unrecognisable replacement must not retain the old root's approval.
    await page.evaluate(() => { window.modernGood.shadowRoot.querySelector('bili-rich-text').shadowRoot.querySelector('span').textContent = ''; });
    await page.waitForFunction(() => window.modernGood.dataset.rbhState === 'pending');
    assert.equal(await page.locator('bili-comment-thread-renderer button').isVisible(), false);
    await page.evaluate(() => { const toggle = window.__ui.querySelector('#reveal'); toggle.checked = true; toggle.dispatchEvent(new Event('change')); });
    assert.equal(await page.locator('bili-comment-thread-renderer button').isVisible(), true);
    assert.equal(await page.locator('#legacy-expand').isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('browser: debug scores appear beside each nickname without extra requests or mutation loops', { skip: !browserEnabled }, async () => {
  const { page, errors } = await setup();
  try {
    await page.waitForFunction(() => window.modernGood.dataset.rbhState === 'allowed');
    await page.evaluate(() => { window.safeDebugReply = addModern('友好的调试回复', true); });
    await page.waitForFunction(() => window.safeDebugReply.dataset.rbhState === 'allowed');
    const count = await page.evaluate(() => window.__requests.length);
    await page.evaluate(() => { const debug = window.__ui.querySelector('#debug'); debug.checked = true; debug.dispatchEvent(new Event('change')); });
    assert.equal(await page.locator('#good .user-name + [data-rbh-debug]').textContent(), 'Jev: 0.01');
    assert.equal(await page.evaluate(() => window.modernGood.shadowRoot.querySelector('bili-user-profile').shadowRoot.querySelector('#name').nextElementSibling.textContent), 'Jev: 0.01');
    assert.equal(await page.evaluate(() => window.safeDebugReply.shadowRoot.querySelector('bili-user-profile').shadowRoot.querySelector('#name').nextElementSibling.textContent), 'Jev: 0.01');
    assert.equal(await page.locator('#bad [data-rbh-debug]').count(), 0);
    assert.equal(await page.evaluate(() => window.__stored['rbh.settings.v1'].debug), true);
    // A profile re-render should reattach one badge without changing the judged text.
    await page.evaluate(() => { window.modernGood.shadowRoot.querySelector('bili-user-profile').shadowRoot.innerHTML = '<span id="name">新的昵称</span>'; });
    await page.waitForFunction(() => window.modernGood.shadowRoot.querySelector('bili-user-profile').shadowRoot.querySelector('[data-rbh-debug]'));
    await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => window.__requests.length), count);
    assert.equal(await page.locator('#good [data-rbh-debug]').count(), 1);
    assert.equal(await page.locator('#good').getAttribute('data-rbh-state'), 'allowed');
    await page.evaluate(() => { const debug = window.__ui.querySelector('#debug'); debug.checked = false; debug.dispatchEvent(new Event('change')); });
    assert.equal(await page.locator('[data-rbh-debug]').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

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

test('browser: native DOM is preserved; pending/blocked/unknown items are masked', { skip: !browserEnabled }, async () => {
  const { page, errors } = await setup({ danmaku: true });
  try {
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-good'))), 0);
    await page.waitForFunction(() => document.querySelector('#native-good').dataset.rbhDm === 'allowed');
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-good'))), 0.7);
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-bad'))), 0);
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-unknown'))), 0);
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-special'))), 0);
    assert.equal(await page.locator('[data-rbh-overlay]').count(), 0);
    const style = await page.locator('#native-good').getAttribute('style');
    assert.match(style, /translateX\(123px\)/);
    assert.match(style, /font-size:28px/);
    // Native display/switch/opacity settings must continue to win after approval.
    await page.evaluate(() => { document.querySelector('.bpx-player-row-dm-wrap').style.display = 'none'; });
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-good'))), 0);
    await page.evaluate(() => { document.querySelector('.bpx-player-row-dm-wrap').style.display = ''; });
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-good'))), 0.7);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('browser: reused native nodes are masked before paint; stale answers cannot approve new text', { skip: !browserEnabled }, async () => {
  const { page } = await setup({ danmaku: true });
  try {
    await page.waitForFunction(() => document.querySelector('#native-good').dataset.rbhDm === 'allowed');
    const opacity = await page.evaluate(async () => {
      const element = document.querySelector('#native-good');
      element.firstChild.data = '恶意复用弹幕';
      await new Promise(requestAnimationFrame);
      return effectiveOpacity(element);
    });
    assert.equal(opacity, 0);
    await page.waitForFunction(() => document.querySelector('#native-good').dataset.rbhDm === 'hidden');
    // Put a new safe text in flight, then replace it with a bad text before the response.
    await page.evaluate(() => { window.__apiDelay = 700; document.querySelector('#native-good').textContent = '新的正常弹幕'; });
    await page.waitForFunction(() => window.__requests.some(r => Object.values(r.body?.state.items || {}).some(item => item.target_text === '新的正常弹幕')));
    await page.evaluate(() => { document.querySelector('#native-good').textContent = '恶意异步替换'; });
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-good'))), 0);
    await page.waitForFunction(() => document.querySelector('#native-good').dataset.rbhDm === 'hidden');
  } finally { await page.close(); }
});

test('browser: a prefetched text is reused without another Jev call; API segment count is authoritative', { skip: !browserEnabled }, async () => {
  const { page } = await setup({ danmaku: true, segments: 2 });
  try {
    await page.waitForFunction(() => window.__ui.querySelector('#counts').textContent.includes('弹幕预取 2/2 段'));
    await page.waitForFunction(() => document.querySelector('#native-good').dataset.rbhDm === 'allowed');
    const calls = await page.evaluate(() => window.__requests.filter(r => r.body).length);
    await page.evaluate(() => {
      const item = document.createElement('div'); item.id = 'native-late'; item.className = 'bili-dm'; item.textContent = '这段讲得真好';
      document.querySelector('.bpx-player-row-dm-wrap').append(item);
    });
    await page.waitForFunction(() => document.querySelector('#native-late').dataset.rbhDm === 'allowed');
    assert.equal(await page.evaluate(() => window.__requests.filter(r => r.body).length), calls);
    assert.equal(await page.evaluate(() => window.__requests.filter(r => r.url.includes('segment_index=2')).length), 1);
  } finally { await page.close(); }
});

test('browser: Canvas and unrecognised branches fail closed; direct text invalidates a safe wrapper', { skip: !browserEnabled }, async () => {
  const { page } = await setup({ danmaku: true });
  try {
    await page.waitForFunction(() => document.querySelector('#native-good').dataset.rbhDm === 'allowed');
    await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.id = 'native-canvas';
      document.querySelector('.bpx-player-row-dm-wrap').append(canvas);
    });
    await page.waitForFunction(() => window.__ui.querySelector('#counts').textContent.includes('Canvas'));
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-canvas'))), 0);
    const opacity = await page.evaluate(async () => {
      document.querySelector('.native-wrapper').append(document.createTextNode('未知的直接文本'));
      await new Promise(requestAnimationFrame);
      return effectiveOpacity(document.querySelector('.native-wrapper'));
    });
    assert.equal(opacity, 0);
    await page.evaluate(() => window.__ui.querySelector('#toggle').click());
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-canvas'))), 1);
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-bad'))), 1);
  } finally { await page.close(); }
});

test('browser: prefetch failure still permits live DOM classification, while model failure does not', { skip: !browserEnabled }, async () => {
  const { page } = await setup({ danmaku: true, viewStatus: 412 });
  try {
    await page.waitForFunction(() => document.querySelector('#native-good').dataset.rbhDm === 'allowed');
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-good'))), 0.7);
    assert.match(await page.evaluate(() => window.__ui.querySelector('#counts').textContent), /412.*出现时判断/);
    await page.evaluate(() => {
      window.__apiStatus = 401;
      document.querySelector('#native-good').textContent = '还未评估的新弹幕';
    });
    await page.waitForFunction(() => window.__ui.querySelector('#status').textContent.includes('鉴权失败'));
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-good'))), 0);
  } finally { await page.close(); }
});

test('browser: SPA navigation does not reuse old approval or accept an old response', { skip: !browserEnabled }, async () => {
  const { page } = await setup({ danmaku: true });
  try {
    await page.waitForFunction(() => document.querySelector('#native-good').dataset.rbhDm === 'allowed');
    await page.evaluate(() => {
      window.__apiDelay = 800;
      document.querySelector('#native-good').textContent = '上一视频的正常弹幕';
    });
    await page.waitForFunction(() => window.__requests.some(r => Object.values(r.body?.state.items || {}).some(item => item.target_text === '上一视频的正常弹幕')));
    const opacity = await page.evaluate(async () => {
      history.pushState({}, '', '/video/BV1xx411c7mD?p=2');
      document.querySelector('h1').textContent = '下一个分P';
      document.querySelector('#native-good').textContent = '恶意换页弹幕';
      await new Promise(requestAnimationFrame);
      return effectiveOpacity(document.querySelector('#native-good'));
    });
    assert.equal(opacity, 0);
    await page.waitForFunction(() => document.querySelector('#native-good').dataset.rbhDm === 'hidden');
    assert.equal(await page.evaluate(() => effectiveOpacity(document.querySelector('#native-good'))), 0);
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
