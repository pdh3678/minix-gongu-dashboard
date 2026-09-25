/* 세션 만료 → 재로그인 경로 검증 (2026-09-18 버그)

   증상: 첫 로그인은 정상인데, 세션이 만료돼 로그인 화면이 다시 뜬 뒤 재로그인에 성공하면
   세션도 발급되고 데이터도 받아오는데 **로그인 오버레이가 그대로 남아** 화면이 갇혔다.
   원인: 오버레이 표시는 #loginScreen의 style.display를 직접 건드려 관리하고, "이미 진입했는가"는
   _dashboardEntered 플래그로 따로 들고 있었다. 만료로 오버레이를 다시 띄울 때 그 플래그를
   되돌리지 않아서, 재로그인 시 `if(!_dashboardEntered)_enterDashboard(user); else fetchLive();`가
   else로 빠져 오버레이를 걷는 코드(_enterDashboard)가 아예 안 불렸다.

   그래서 이 스위트가 지키는 것:
     · 오버레이 표시 여부는 _isAuthed 하나로만 결정된다(직접 DOM 조작 금지)
     · 첫 로그인 / 만료 후 재로그인 / 새로고침 세션 복원이 전부 onLoginSuccess 한 곳을 지난다
     · 만료 → 재로그인 후 오버레이가 반드시 걷히고, 보던 페이지(해시)로 복귀한다
     · 일반 모드와 임베드(?embed=1) 모드가 똑같이 동작한다
     · AUTH_REQUIRED 응답을 "구버전 배포본"으로 오해하는 로그를 남기지 않는다

   만료는 기다리지 않고 **서버 시트의 expiresAt을 과거로 돌려** 만든다(session-auth.test.js와
   같은 방식) — 만료 상수를 임시로 줄였다가 되돌리는 수동 절차보다 정확하고 반복 가능하다.
   프론트와 GAS를 둘 다 실제로 실행하고 그 사이의 HTTP만 직결로 대체한다.

   실행: node tests/relogin.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeSheet, installGlobals } = require(path.join(__dirname, 'lib', 'mock-sheets.js'));
const BASE_HEADERS = require(path.join(__dirname, 'lib', 'real-headers.js'));
const { loadFrontend, extractScripts, stubNode, readFrontSource } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const GAS_PATH = path.join(PROJ, 'apps-script.js');
const SECRET = 'test-secret-v1-0123456789';
const CLIENT_ID = '379680980952-vcvtnv1le4lmma2f0gv6snita17ve7bd.apps.googleusercontent.com';
const EMAIL = 'p_dh_3678@athomecorp.com';
const GAS_URL = 'https://script.google.com/macros/s/test/exec';

const SHIM = `
  get isAuthed(){return _isAuthed;},
  get currentPageHash(){return _currentPageHash;},
  get ST(){return ST;}`;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

function tokenInfoMock() {
  return () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({
      aud: CLIENT_ID, iss: 'https://accounts.google.com', email: EMAIL,
      email_verified: 'true', hd: 'athomecorp.com', name: '관리자',
      exp: String(Math.floor(Date.now() / 1000) + 3600)
    })
  });
}

// ── 서버(GAS)를 실제로 띄운다 ──
// 열 위치(save-path.test.js와 동일). 공구건 1건을 넣어 두는 이유는, fetchLive가 빈 응답에
// "데이터가 비어있습니다"로 실패하면 로그인 성공 경로를 끝까지 따라가 볼 수 없기 때문이다.
const C = { brand:1, product:2, channel:4, platform:5, code:9, salePrice:10, qty:11,
  revenue:12, year:14, startMD:15, endMD:16, status:17, dealId:44, codeSeq:45 };
function loadGas() {
  const row = new Array(BASE_HEADERS.length).fill('');
  Object.entries({
    [C.brand]:'미닉스', [C.product]:'더 슬림', [C.channel]:'채널A', [C.platform]:'인스타그램',
    [C.code]:'AAA', [C.salePrice]:29000, [C.qty]:100, [C.revenue]:2900000, [C.year]:2026,
    [C.startMD]:'2026-09-01', [C.endMD]:'2026-09-03', [C.status]:'완료',
    [C.dealId]:'D1', [C.codeSeq]:1
  }).forEach(([k, v]) => { row[k] = v; });
  const sheets = { '실적통합': makeSheet('실적통합', [[], BASE_HEADERS.slice(), row]) };
  installGlobals(sheets, { scriptProps: { SESSION_SECRET_V1: SECRET }, urlFetch: tokenInfoMock() });
  global.Logger = { log(){} };
  const ctx = vm.createContext(global);
  vm.runInContext(fs.readFileSync(GAS_PATH, 'utf8'), ctx, { filename: 'apps-script.js' });
  ctx.__sheets = sheets;
  return ctx;
}
// 시트의 expiresAt을 과거로 돌려 "절대 만료"를 즉시 만든다(2분 대기 대신)
function expireSession(gas) {
  const sh = gas.__sheets['_sessions'];
  if (!sh || !sh._grid[1]) throw new Error('세션 행이 없습니다 — 먼저 로그인해야 합니다');
  sh._grid[1][4] = Date.now() - 1000;
}

/* 프론트의 fetch를 실제 GAS 핸들러로 직결한다 — _gasFetch를 손대지 않는 것이 핵심이다.
   AUTH_REQUIRED 처리(세션 폐기 + 오버레이 표시)가 바로 그 함수 안에 있으므로, 그 코드가
   실제로 실행되지 않으면 이 버그를 재현할 수 없다. */
function bridgeFetch(gas) {
  return async (url, opts) => {
    const u = new URL(String(url), 'https://example.test/');
    const parameter = {};
    u.searchParams.forEach((v, k) => { parameter[k] = v; });
    const body = opts && opts.body;
    const text = (opts && opts.method === 'POST')
      ? gas.doPost({ parameter, postData: { contents: body } })
      : gas.doGet({ parameter });
    return { status: 200, json: async () => JSON.parse(text) };
  };
}

/* 값을 실제로 기억하는 DOM. style.display를 읽어야 하므로 삼키는 스텁만으로는 안 되고,
   반대로 전부 직접 구현하면 캔버스(getContext) 같은 것까지 흉내 내야 한다.
   그래서 우리가 검사하는 속성만 진짜로 들고, 나머지는 샌드박스의 만능 스텁으로 넘긴다. */
function makeDom() {
  const els = {};
  const mk = id => {
    const real = {
      id, value: '', textContent: '', innerHTML: '', readOnly: false, disabled: false,
      style: {}, dataset: {},
      classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
        contains(c){return this._s.has(c);}, toggle(c){this._s.has(c)?this._s.delete(c):this._s.add(c);} }
    };
    return new Proxy(real, {
      get: (t, k) => (k in t ? t[k] : stubNode()),
      set: (t, k, v) => { t[k] = v; return true; }
    });
  };
  return { els, get: id => (els[id] = els[id] || mk(id)) };
}

// 로그인 직전 상태의 프론트 하나를 만든다(세션 없음 = 로그인 화면)
function bootFront(gas, opts) {
  const { ctx, X } = loadFrontend(PROJ, SHIM, opts || {});
  const dom = makeDom();
  ctx.document.getElementById = dom.get;
  ctx.fetch = bridgeFetch(gas);
  ctx.localStorage.setItem('gp_gas_url', GAS_URL);
  return { ctx, X, dom };
}
const overlay = dom => dom.els.loginScreen && dom.els.loginScreen.style.display;
// 실제 로그인 흐름 그대로: 구글 credential → _exchangeForSession → onLoginSuccess
async function doLogin(ctx) {
  await ctx._exchangeForSession('google-id-token');
  await new Promise(r => setTimeout(r, 20));
}

(async () => {
  console.log('\n[1] 인증 상태 단일 소스 — 오버레이는 _isAuthed로만 움직인다');
  {
    const gas = loadGas();
    const { ctx, X, dom } = bootFront(gas);
    check('_setAuthed / onLoginSuccess가 정의됨',
      typeof ctx._setAuthed === 'function' && typeof ctx.onLoginSuccess === 'function',
      { setAuthed: typeof ctx._setAuthed, onLoginSuccess: typeof ctx.onLoginSuccess });
    ctx._setAuthed(true);
    check('_setAuthed(true) → 오버레이 숨김', overlay(dom) === 'none' && X.isAuthed === true, overlay(dom));
    ctx._setAuthed(false);
    check('_setAuthed(false) → 오버레이 표시', overlay(dom) === 'flex' && X.isAuthed === false, overlay(dom));
    ctx._showReloginScreen();
    check('_showReloginScreen도 같은 상태를 쓴다', overlay(dom) === 'flex' && X.isAuthed === false);

    /* 샌드박스 DOM은 어떤 id에도 객체를 돌려주므로, "직접 조작이 남아있다"는 실행만으로는
       못 잡는다. 배포되는 소스 자체를 읽어 loginScreen.style.display를 쓰는 지점이
       _setAuthed 하나뿐인지 확인한다(이 버그의 재발 방지선). */
    const src = extractScripts(PROJ).join('\n');
    const writes = src.match(/getElementById\(['"]loginScreen['"]\)\.style\.display\s*=/g) || [];
    check('loginScreen.style.display에 직접 대입하는 곳이 정확히 1군데(_setAuthed)',
      writes.length === 1, writes);
    // 주석(설명용으로 옛 플래그 이름을 남겨둠)은 빼고, 실제 코드에만 남아있지 않은지 본다
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    check('제거된 _dashboardEntered 플래그를 실제 코드가 참조하지 않음',
      codeOnly.indexOf('_dashboardEntered') === -1, 'still referenced in code');
  }

  console.log('\n[2] 첫 로그인 — onLoginSuccess를 지나 오버레이가 걷힌다');
  {
    const gas = loadGas();
    const { ctx, X, dom } = bootFront(gas);
    check('로그인 전에는 오버레이가 떠 있어야 정상', X.isAuthed === false);
    await doLogin(ctx);
    check('세션 토큰 저장됨', !!ctx.localStorage.getItem('gp_session'),
      Object.keys(ctx.localStorage.getItem ? {} : {}));
    check('오버레이 제거됨', overlay(dom) === 'none' && X.isAuthed === true, overlay(dom));
    check('사이드바에 사용자 표시됨', dom.els.sbUserName.textContent === '관리자',
      dom.els.sbUserName.textContent);
  }

  console.log('\n[3] ★ 버그 재현 — 만료 → AUTH_REQUIRED → 재로그인 → 오버레이가 걷히는가');
  {
    const gas = loadGas();
    const { ctx, X, dom } = bootFront(gas);
    await doLogin(ctx);
    check('1) 첫 로그인 성공 — 오버레이 없음', X.isAuthed === true, overlay(dom));

    // 2) 세션 절대 만료 → 아무 요청이나 하면 서버가 AUTH_REQUIRED로 거절한다
    expireSession(gas);
    await ctx.fetchLive();
    check('2) 만료된 세션으로 fetchLive → 오버레이 다시 표시', X.isAuthed === false, overlay(dom));
    check('2) 죽은 세션 토큰은 폐기됨', !ctx.localStorage.getItem('gp_session'));

    // 3) 재로그인 — 예전에는 여기서 오버레이가 남았다
    await doLogin(ctx);
    check('3) ★ 재로그인 후 오버레이가 반드시 걷힌다', overlay(dom) === 'none' && X.isAuthed === true,
      { display: overlay(dom), isAuthed: X.isAuthed });
    check('3) 새 세션이 저장됨', !!ctx.localStorage.getItem('gp_session'));
    check('3) 사용자 표시도 복구됨', dom.els.sbUserName.textContent === '관리자',
      dom.els.sbUserName.textContent);
  }

  console.log('\n[4] 임베드 모드(?embed=1)에서도 같은 경로가 동작');
  {
    const gas = loadGas();
    const { ctx, X, dom } = bootFront(gas, { search: '?embed=1', runHeadScripts: true });
    check('임베드 모드로 로드됨', X.IS_EMBED === true);
    await doLogin(ctx);
    check('첫 로그인 — 오버레이 없음', X.isAuthed === true);
    expireSession(gas);
    await ctx.fetchLive();
    check('만료 → 오버레이 표시', X.isAuthed === false);
    await doLogin(ctx);
    check('★ 재로그인 후 오버레이가 걷힌다(임베드)', overlay(dom) === 'none' && X.isAuthed === true,
      { display: overlay(dom), isAuthed: X.isAuthed });
    const urls = ctx.history._urls;
    check('임베드 쿼리(?embed=1)가 재로그인 뒤에도 유지됨',
      urls.length > 0 && urls[urls.length - 1].includes('?embed=1'), urls.slice(-1));
  }

  console.log('\n[5] 워크스페이스 메뉴별 — 만료 후 재로그인 시 보던 페이지로 복귀');
  {
    // 워크스페이스 iframe이 메뉴마다 다른 해시로 들어온다 — 각자 자기 페이지로 돌아와야 한다
    const MENUS = [
      { hash: 'calendar',        label: '공구 캘린더' },
      { hash: 'dashboard',       label: '대시보드' },
      { hash: 'product-TheSlim', label: '품목별 실적(더 슬림)' },
      { hash: 'entry-list',      label: '실적 미기입 목록' },
      { hash: 'review',          label: '회고' }
    ];
    for (const m of MENUS) {
      const gas = loadGas();
      const { ctx, X, dom } = bootFront(gas, { search: '?embed=1', runHeadScripts: true });
      ctx.location.hash = '#' + m.hash;
      await doLogin(ctx);
      const afterFirst = X.currentPageHash;
      expireSession(gas);
      await ctx.fetchLive();
      check(`${m.label}: 만료 시 오버레이 표시`, X.isAuthed === false);
      await doLogin(ctx);
      check(`${m.label}: 재로그인 후 오버레이 제거 + 같은 페이지 복귀(#${m.hash})`,
        X.isAuthed === true && X.currentPageHash === afterFirst && afterFirst === m.hash,
        { isAuthed: X.isAuthed, first: afterFirst, after: X.currentPageHash });
    }
  }

  console.log('\n[6] 로그아웃 후 다시 로그인 — 기존 경로도 그대로 동작');
  {
    const gas = loadGas();
    const { ctx, X, dom } = bootFront(gas);
    await doLogin(ctx);
    ctx.signOut();
    check('로그아웃 → 오버레이 표시', overlay(dom) === 'flex' && X.isAuthed === false, overlay(dom));
    check('로그아웃 시 사용자 표시 지워짐', dom.els.sbUserName.textContent === '—');
    await doLogin(ctx);
    check('로그아웃 후 재로그인 — 오버레이 제거', overlay(dom) === 'none' && X.isAuthed === true);
  }

  console.log('\n[7] 새로고침(세션 복원)도 같은 창구를 지난다');
  {
    // 부트스트랩은 인라인 스크립트 최상위에서 도는 경로라, 여기서는 그 경로가 쓰는
    // onLoginSuccess가 세션 저장 + 오버레이 제거를 함께 하는지만 직접 확인한다.
    const gas = loadGas();
    const { ctx, X, dom } = bootFront(gas);
    const tok = JSON.parse(gas.doGet({ parameter: { action: 'login', idToken: 'x' } })).sessionToken;
    ctx.onLoginSuccess({ sessionToken: tok, user: { email: EMAIL, name: '관리자' } });
    await new Promise(r => setTimeout(r, 20));
    check('세션 복원 경로도 오버레이를 걷는다', overlay(dom) === 'none' && X.isAuthed === true);
    check('세션 복원 경로도 토큰을 저장한다', ctx.localStorage.getItem('gp_session') === tok);
  }

  console.log('\n[8] AUTH_REQUIRED를 "구버전 배포본"으로 오해하지 않는다');
  {
    const gas = loadGas();
    const { ctx } = bootFront(gas);
    await doLogin(ctx);
    expireSession(gas);
    const logs = [];
    const realLog = ctx.console.log, realErr = ctx.console.error, realWarn = ctx.console.warn;
    ctx.console = Object.assign({}, ctx.console, {
      log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')),
      warn: (...a) => logs.push(a.join(' '))
    });
    await ctx.fetchLive();
    ctx.console.log = realLog; ctx.console.error = realErr; ctx.console.warn = realWarn;
    const joined = logs.join('\n');
    check('AUTH_REQUIRED 응답에 "구버전 배포본" 로그가 안 남음',
      joined.indexOf('버전 필드 없음') === -1, logs.filter(l => l.includes('버전')));
    check('대신 인증 실패로 명확히 남음', joined.indexOf('AUTH_REQUIRED') !== -1);
    check('버전 불일치 경고도 안 남음(인증 문제를 배포 문제로 오해시키지 않음)',
      joined.indexOf('[버전 불일치]') === -1, logs.filter(l => l.includes('불일치')));
  }

  console.log('\n[9] 서버 — 에러 응답에도 version이 실린다');
  {
    const gas = loadGas();
    const token = JSON.parse(gas.doGet({ parameter: { action: 'login', idToken: 'x' } })).sessionToken;
    expireSession(gas);
    const r = JSON.parse(gas.doGet({ parameter: { session: token } }));
    check('만료 세션은 AUTH_REQUIRED(reason=expired)', r.error === 'AUTH_REQUIRED' && r.reason === 'expired', r);
    check('AUTH_REQUIRED 응답에도 version이 있다', typeof r.version === 'string' && r.version.length > 0, r.version);
    check('version이 SCRIPT_VERSION과 일치', r.version === gas.SCRIPT_VERSION, { got: r.version, want: gas.SCRIPT_VERSION });
    // 세션이 아예 없는 요청도 마찬가지
    const r2 = JSON.parse(gas.doGet({ parameter: {} }));
    check('세션 없는 요청의 에러 응답에도 version이 있다',
      r2.error === 'AUTH_REQUIRED' && typeof r2.version === 'string', r2);
    // 성공 응답의 version은 기존대로 유지(덮어쓰지 않는다)
    const gas2 = loadGas();
    const t2 = JSON.parse(gas2.doGet({ parameter: { action: 'login', idToken: 'x' } })).sessionToken;
    const ok = JSON.parse(gas2.doGet({ parameter: { session: t2 } }));
    check('정상 응답의 version도 그대로', ok.version === gas2.SCRIPT_VERSION, ok.version);
  }

  console.log('\n[10] 프론트가 요구하는 GAS 버전과 실제 GAS 버전이 맞는가');
  {
    const html = readFrontSource(PROJ);
    const req = (html.match(/REQUIRED_SCRIPT_VERSION='([^']+)'/) || [])[1];
    const gasv = (fs.readFileSync(GAS_PATH, 'utf8').match(/SCRIPT_VERSION = '([^']+)'/) || [])[1];
    check('REQUIRED_SCRIPT_VERSION == apps-script.js의 SCRIPT_VERSION',
      !!req && req === gasv, { required: req, gas: gasv });
  }

  console.log('\n' + '─'.repeat(50));
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})();
