/* index.html이 싣는 스크립트를 node에서 그대로 실행하기 위한 샌드박스.

   대시보드는 빌드 단계가 없다. 본체는 src/ 아래 일반 <script> 파일들이고(2026-09-25 분할 —
   모듈이 아니라 전역을 공유), index.html의 <script src> 순서가 곧 실행 순서다. 테스트용으로
   코드를 따로 조립하면 "테스트가 검증하는 코드"와 "실제로 배포되는 코드"가 갈라지므로, 이
   샌드박스는 index.html을 읽어 **같은 파일을 같은 순서로** 허용적인 DOM 스텁 위에서 실행한다.

   ⚠ const/let 선언은 vm 컨텍스트의 프로퍼티로 노출되지 않는다(function 선언과 var만 노출됨).
      그래서 스크립트 끝에 접근자 shim을 덧붙여서 필요한 것만 꺼내 쓴다. */
const fs = require('fs'), path = require('path'), vm = require('vm');

// 어떤 속성 접근/호출도 조용히 삼키는 DOM 노드 스텁 — 화면을 검증하려는 게 아니라
// "화면 코드 때문에 로직이 못 돌아가는 일"만 막으면 되므로 이 정도로 충분하다.
function stubNode() {
  const t = function () { return stubNode(); };
  return new Proxy(t, {
    get(_, k) {
      if (k === 'length') return 0;
      if (k === 'value' || k === 'textContent' || k === 'innerHTML' || k === 'dataset') return '';
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'style') return {};
      if (k === Symbol.toPrimitive || k === 'toString') return () => '';
      if (k === 'then') return undefined; // await 대상이 되지 않도록
      return stubNode();
    },
    set() { return true; }, apply() { return stubNode(); }, has() { return true; }
  });
}

function makeStorage() {
  const m = {};
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    clear() { for (const k in m) delete m[k]; }
  };
}

/* index.html의 script 태그를 문서 순서대로 읽는다.
   inline — 태그 안에 코드가 있는 것(head의 임베드 판정 등)
   file   — src="src/..." 로 싣는 대시보드 본체 파일
   외부 CDN(chart.js·GSI)과 빌드 산출물(review-assets/)은 앱 코드가 아니므로 제외한다. */
function scriptEntries(projectPath) {
  const html = fs.readFileSync(path.join(projectPath, 'index.html'), 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = (m[1].match(/\bsrc="([^"]+)"/) || [])[1];
    if (!src) { out.push({ kind: 'inline', name: 'index.html(inline script)', code: m[2], tag: m[0] }); continue; }
    if (!/^src\//.test(src)) continue;
    const code = fs.readFileSync(path.join(projectPath, src), 'utf8');
    out.push({ kind: 'file', name: src, code, tag: m[0] });
  }
  if (!out.some(e => e.kind === 'file')) throw new Error('index.html에서 src/ 스크립트를 찾지 못했습니다.');
  return out;
}
// 문서 순서대로 모든 앱 스크립트 코드(인라인 + src/ 파일) — 소스 텍스트를 정적으로 검사할 때 쓴다
function extractScripts(projectPath) {
  return scriptEntries(projectPath).map(e => e.code);
}
// 대시보드 본체(src/ 파일 전부를 로드 순서대로 이은 것)
function extractMainScript(projectPath) {
  return scriptEntries(projectPath).filter(e => e.kind === 'file').map(e => e.code).join('\n');
}
/* index.html에서 src/ 스크립트 태그를 그 파일 내용의 인라인 태그로 바꾼 문서.
   "마크업·CSS와 코드를 한 문서에서 함께 대조하는" 정적 검사용 — 예전 단일 HTML과 같은 모양이라
   코드 위치(어느 태그 앞/뒤인지)도 그대로 비교된다. */
function readFrontSource(projectPath) {
  let html = fs.readFileSync(path.join(projectPath, 'index.html'), 'utf8');
  for (const e of scriptEntries(projectPath)) {
    if (e.kind === 'file') html = html.replace(e.tag, () => '<script>/* ' + e.name + ' */\n' + e.code + '</script>');
  }
  return html;
}

/* 프론트를 로드해 { ctx, X, src } 반환.
   ctx — vm 컨텍스트(함수 선언들이 여기 올라와 있고, 스텁으로 갈아끼울 수도 있다)
   X   — const/let 값 접근용 shim (DATA, 버전 문자열, _savingDeals 등)

   opts.search         — location.search 값('?embed=1' 등). 임베드 모드 검증용.
   opts.runHeadScripts — true면 본체보다 앞에 있는 작은 인라인 스크립트(임베드 판정 등)도
                         문서 순서대로 먼저 실행한다. 실제 브라우저와 같은 순서를 재현하기 위함. */
function loadFrontend(projectPath, extraShimBody, opts) {
  opts = opts || {};
  const entries = scriptEntries(projectPath);
  const files = entries.filter(e => e.kind === 'file');
  const head = entries.filter(e => e.kind === 'inline').map(e => e.code);
  const src = files.map(e => e.code).join('\n');
  const search = opts.search || '';

  const sandbox = {
    console, Math, Date, JSON, Number, String, Boolean, Array, Object, Map, Set, RegExp, Error,
    isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Promise,
    document: {
      getElementById: () => stubNode(), querySelector: () => stubNode(),
      querySelectorAll: () => ({ length: 0, forEach() {}, map: () => [] }),
      createElement: () => stubNode(), addEventListener() {}, removeEventListener() {},
      body: stubNode(), head: stubNode(), cookie: '', readyState: 'complete',
      // html 요소의 클래스는 임베드 판정 결과가 실제로 실리는 곳이라 진짜로 동작해야 한다
      documentElement: {
        classList: {
          _s: new Set(),
          add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
          contains(c) { return this._s.has(c); },
          toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        }
      }
    },
    localStorage: makeStorage(), sessionStorage: makeStorage(),
    location: {
      protocol: 'https:', hash: '', pathname: '/', search,
      origin: 'https://minix-gongu-dashboard.onrender.com',
      href: 'https://minix-gongu-dashboard.onrender.com/' + search
    },
    // _setHash가 실제로 어떤 URL을 쓰는지 봐야 하므로 기록형 스텁
    history: {
      _urls: [],
      replaceState(_s, _t, url) { this._urls.push(url); },
      pushState(_s, _t, url) { this._urls.push(url); }
    },
    navigator: { userAgent: 'node' },
    Chart: function () { return stubNode(); },
    fetch: async () => ({ status: 200, json: async () => ({}) }),
    AbortController: function () { this.signal = {}; this.abort = () => {}; },
    requestAnimationFrame: cb => setTimeout(cb, 0),
    alert() {}, confirm: () => false,
    crypto: { randomUUID: () => 'u' + Math.random().toString(36).slice(2) },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    performance: { now: () => Date.now() },
    URL, URLSearchParams, TextEncoder, Intl, Symbol, Proxy, Reflect, Function,
    // 브라우저에는 항상 있는 전역 — 세션 토큰 페이로드 디코드(_decodeSessionPayload)가 쓴다
    atob: v => Buffer.from(String(v), 'base64').toString('binary'),
    btoa: v => Buffer.from(String(v), 'binary').toString('base64'),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, scrollTo() {},
    innerWidth: 1280, innerHeight: 900
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const shim = `
;globalThis.__X__ = {
  get DATA(){return DATA;},
  get DASHBOARD_VERSION(){return DASHBOARD_VERSION;},
  get REQUIRED_SCRIPT_VERSION(){return REQUIRED_SCRIPT_VERSION;},
  get IS_EMBED(){return IS_EMBED;},
  get savingDeals(){return _savingDeals;},
  setSyncReady(v){_tierSyncReady=v;},
  /* 모달 상태는 전부 let 선언이라 vm 컨텍스트 프로퍼티로 노출되지 않는다.
     저장 함수를 통으로 실행해 보려면 밖에서 이 값들을 세팅할 수 있어야 하므로 세터를 둔다. */
  setModalState(st){
    if(st.dealId!==undefined)_modalDealId=st.dealId;
    if(st.channel!==undefined)_modalChannel=st.channel;
    if(st.codes!==undefined)_modalCodes=st.codes;
    if(st.gifts!==undefined)_modalGifts=st.gifts;
    if(st.reels!==undefined)_modalReels=st.reels;
    if(st.hadReels!==undefined)_modalHadReels=st.hadReels;
  },
  setFormState(st){
    if(st.codes!==undefined)_formCodes=st.codes;
    if(st.gifts!==undefined)_formGifts=st.gifts;
  }${extraShimBody ? ',\n  ' + extraShimBody : ''}
};`;

  const ctx = vm.createContext(sandbox);
  if (opts.runHeadScripts) {
    head.forEach((s, i) => vm.runInContext(s, ctx, { filename: 'index.html(head script ' + i + ')' }));
  }
  /* 파일마다 따로 실행한다(브라우저의 <script>와 같다) — 최상위 const/let은 같은 컨텍스트 안에서
     파일 사이에 공유되지만, 함수 호이스팅은 파일을 넘지 않는다. 한 덩어리로 이어 붙이면 이 차이가
     가려져 "테스트는 통과하는데 브라우저에서는 ReferenceError"가 생길 수 있다. */
  files.forEach(f => vm.runInContext(f.code, ctx, { filename: f.name }));
  vm.runInContext(shim, ctx, { filename: 'front-sandbox(shim)' });
  return { ctx, X: ctx.__X__, src, head };
}

module.exports = { loadFrontend, extractMainScript, extractScripts, readFrontSource, scriptEntries, stubNode };
