/* index.html의 인라인 스크립트를 node에서 그대로 실행하기 위한 샌드박스.

   대시보드는 빌드 단계가 없는 단일 HTML이라, 테스트를 위해 코드를 모듈로 쪼개면 그 순간
   "테스트가 검증하는 코드"와 "실제로 배포되는 코드"가 갈라진다. 그래서 쪼개는 대신, 배포되는
   index.html에서 스크립트를 그대로 꺼내 허용적인 DOM 스텁 위에서 실행한다.

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

// index.html에서 가장 큰 인라인 <script>(대시보드 본체)를 꺼낸다
function extractMainScript(projectPath) {
  const html = fs.readFileSync(path.join(projectPath, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!scripts.length) throw new Error('index.html에서 인라인 스크립트를 찾지 못했습니다.');
  return scripts.sort((a, b) => b.length - a.length)[0];
}

/* 프론트를 로드해 { ctx, X, src } 반환.
   ctx — vm 컨텍스트(함수 선언들이 여기 올라와 있고, 스텁으로 갈아끼울 수도 있다)
   X   — const/let 값 접근용 shim (DATA, 버전 문자열, _savingDeals 등) */
function loadFrontend(projectPath, extraShimBody) {
  const src = extractMainScript(projectPath);
  const sandbox = {
    console, Math, Date, JSON, Number, String, Boolean, Array, Object, Map, Set, RegExp, Error,
    isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Promise,
    document: {
      getElementById: () => stubNode(), querySelector: () => stubNode(),
      querySelectorAll: () => ({ length: 0, forEach() {}, map: () => [] }),
      createElement: () => stubNode(), addEventListener() {}, removeEventListener() {},
      body: stubNode(), documentElement: stubNode(), head: stubNode(),
      cookie: '', readyState: 'complete'
    },
    localStorage: makeStorage(), sessionStorage: makeStorage(),
    location: { protocol: 'https:', hash: '', href: 'https://minix-gongu-dashboard.onrender.com/' },
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
  get savingDeals(){return _savingDeals;},
  setSyncReady(v){_tierSyncReady=v;}${extraShimBody ? ',\n  ' + extraShimBody : ''}
};`;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(src + shim, ctx, { filename: 'index.html(inline script)' });
  return { ctx, X: ctx.__X__, src };
}

module.exports = { loadFrontend, extractMainScript, stubNode };
