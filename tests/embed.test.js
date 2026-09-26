/* 임베드 모드(?embed=1) 검증.

   지키려는 성질:
     · ?embed=1 이면 첫 페인트 전에 html.embed 클래스가 붙는다(늦게 붙으면 사이드바가 깜빡임)
     · 그 클래스가 실제로 사이드바·헤더를 숨기고 본문 여백을 0으로 만드는 CSS와 연결돼 있다
     · 내부 메뉴 이동(_setHash) 후에도 ?embed=1 이 URL에 남는다  ← 실제로 있었던 버그
     · embed가 없거나 다른 값이면 평소대로 동작한다
     · Render 응답 헤더가 iframe 임베드를 허용하도록 설정돼 있다

   실행: node tests/embed.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path');
const { loadFrontend, readFrontSource } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const html = readFrontSource(PROJ);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

console.log('\n[1] ?embed=1 — 첫 페인트 전에 html.embed 부착');
{
  const { ctx, X } = loadFrontend(PROJ, null, { search: '?embed=1', runHeadScripts: true });
  check('html에 embed 클래스', ctx.document.documentElement.classList.contains('embed'));
  check('IS_EMBED = true', X.IS_EMBED === true, X.IS_EMBED);
}

console.log('\n[2] 임베드 판정이 head 스크립트에 있어야 함 (본문 스크립트면 깜빡임 발생)');
{
  const styleEnd = html.indexOf('</style>');
  const mainScript = html.indexOf('const DASHBOARD_VERSION');
  const detect = html.indexOf("classList.add('embed')");
  check('판정 코드가 존재', detect > 0, detect);
  check('style 직후 ~ 본문 스크립트 이전에 위치', detect > styleEnd && detect < mainScript,
    { detect, styleEnd, mainScript });
}

console.log('\n[3] embed 클래스에 실제 숨김 CSS가 연결돼 있음');
{
  const css = html.slice(0, html.indexOf('</style>'));
  check('사이드바 숨김', /html\.embed[^{]*\.sidebar/.test(css.replace(/\n/g, ' ')));
  check('헤더 숨김', /html\.embed[^{]*\.hdr\s*\{\s*display:\s*none/.test(css.replace(/\n/g, ' ')));
  check('본문 좌측 여백 0', /html\.embed\s+\.app-main\{margin-left:0\}/.test(css));
  check('사이드바 접힘 상태도 무력화', css.indexOf('html.embed .app-shell.sb-collapsed .app-main{margin-left:0}') > 0);
}

console.log('\n[4] 내부 이동 후에도 ?embed=1 유지 (실제로 있었던 버그)');
{
  const { ctx } = loadFrontend(PROJ, null, { search: '?embed=1', runHeadScripts: true });
  ctx._setHash('calendar');
  const url = ctx.history._urls[ctx.history._urls.length - 1];
  check('_setHash가 URL을 기록', !!url, ctx.history._urls);
  check('embed 파라미터 보존', url.indexOf('embed=1') >= 0, url);
  check('해시도 정상', url.indexOf('#calendar') >= 0, url);
  check('형태가 pathname+search+hash', url === '/?embed=1#calendar', url);
}

console.log('\n[5] 다른 쿼리 파라미터도 함께 보존 (embed 전용 하드코딩이 아님)');
{
  const { ctx } = loadFrontend(PROJ, null, { search: '?embed=1&foo=bar', runHeadScripts: true });
  ctx._setHash('mgmt');
  const url = ctx.history._urls[ctx.history._urls.length - 1];
  check('쿼리 전체 보존', url === '/?embed=1&foo=bar#mgmt', url);
}

console.log('\n[6] embed가 없으면 평소대로');
{
  const { ctx, X } = loadFrontend(PROJ, null, { search: '', runHeadScripts: true });
  check('embed 클래스 없음', !ctx.document.documentElement.classList.contains('embed'));
  check('IS_EMBED = false', X.IS_EMBED === false, X.IS_EMBED);
  ctx._setHash('calendar');
  const url = ctx.history._urls[ctx.history._urls.length - 1];
  check('쿼리 없을 때 URL 정상', url === '/#calendar', url);
}
{
  const { X } = loadFrontend(PROJ, null, { search: '?embed=0', runHeadScripts: true });
  check('embed=0은 임베드 아님', X.IS_EMBED === false, X.IS_EMBED);
}

console.log('\n[7] Render 응답 헤더 설정');
{
  const yaml = fs.readFileSync(path.join(PROJ, 'render.yaml'), 'utf8');
  check('frame-ancestors 설정됨', yaml.indexOf('frame-ancestors') > 0);
  check("'self' 허용", /frame-ancestors[^\n]*'self'/.test(yaml));
  check('워크스페이스 도메인 허용', yaml.indexOf('https://minix-workspace.onrender.com') > 0);
  // X-Frame-Options는 frame-ancestors보다 우선 적용돼 임베드를 막으므로 선언돼 있으면 안 된다.
  // 주석에서 언급하는 건 괜찮으므로, 주석을 걷어낸 뒤 name: 선언만 본다
  // (정규식 이스케이프에 기대지 않고 문자열로 판정 — 조용히 아무것도 매칭 못 하는 사고 방지).
  const declaredHeaders = yaml.split('\n')
    .map(l => l.split('#')[0].trim())
    .filter(l => l.toLowerCase().startsWith('- name:') || l.toLowerCase().startsWith('name:'))
    .map(l => l.slice(l.indexOf(':') + 1).trim().toLowerCase());
  check('선언된 헤더를 실제로 읽어옴', declaredHeaders.length >= 2, declaredHeaders);
  check('Content-Security-Policy 선언됨', declaredHeaders.indexOf('content-security-policy') >= 0, declaredHeaders);
  check('X-Frame-Options 헤더 선언 없음(있으면 frame-ancestors보다 우선해 임베드가 막힘)',
    declaredHeaders.indexOf('x-frame-options') < 0, declaredHeaders);
}

console.log('\n[8] 로그인 화면은 셸 바깥 전체 오버레이 — 임베드에서도 사이드바 없이 뜸');
{
  const shellAt = html.indexOf('<div class="app-shell"');
  const loginAt = html.indexOf('<div id="loginScreen">');
  check('loginScreen이 app-shell 밖(앞쪽)에 있음', loginAt > 0 && loginAt < shellAt, { loginAt, shellAt });
  check('전체화면 오버레이로 고정', /#loginScreen\{position:fixed;inset:0/.test(html));
}


console.log('\n[9] 페이지 단위 임베드 — 해시 라우트로 직접 접속');
{
  // 라우팅 대상 5개 + 인코딩 변형. navPage/navSales를 가로채 "어느 페이지로 갔는지"만 관찰한다.
  const ROUTES = [
    ['calendar',            'page:calendar'],
    ['dashboard',           'page:dashboard'],
    ['review',              'page:review'],
    // 표준 ASCII 슬러그
    ['product-TheFlender',  'sales:플렌더'],
    ['product-TheShift',    'sales:시프트'],
    ['product-TheAirDry',   'sales:에어드라이'],
    // 손으로 옮겨 적은 대소문자 변형
    ['product-theflender',  'sales:플렌더'],
    ['product-THESHIFT',    'sales:시프트'],
    // 과거 한글 슬러그 — 기존 링크가 계속 살아 있어야 한다
    ['product-더플렌더',     'sales:플렌더'],
    ['product-더시프트',     'sales:시프트'],
    // 브라우저가 프래그먼트를 퍼센트 인코딩해 돌려주는 경우 — 디코딩 없이는 기본 탭으로 떨어진다
    ['product-' + encodeURIComponent('더플렌더'), 'sales:플렌더'],
    ['product-' + encodeURIComponent('더시프트'), 'sales:시프트']
  ];
  ROUTES.forEach(([hash, expect]) => {
    const { ctx, X } = loadFrontend(PROJ, null, { search: '?embed=1', runHeadScripts: true });
    let landed = null;
    ctx.navPage = (pageId) => { landed = 'page:' + pageId; };
    ctx.navSales = (el, prod) => { landed = 'sales:' + prod; };
    ctx.openDealForm = () => { landed = 'form'; };
    ctx.location.hash = '#' + hash;
    ctx._routeFromHash();
    check('#' + hash + ' → ' + expect, landed === expect, { landed, expect });
    check('  ↳ 임베드 유지', X.IS_EMBED === true);
  });
}

console.log('\n[10] 로그인 화면은 같은 페이지 오버레이 — 해시/쿼리가 살아남음');
{
  // 로그인 때문에 다른 주소로 튕기면 원래 요청 경로가 사라진다. 이 앱은 #loginScreen을
  // 덮어씌우기만 하므로 URL이 그대로고, 로그인 후 _routeFromHash가 그 해시를 그대로 읽는다.
  // 예외는 문서 맨 위의 서비스 주소 이전 스크립트 하나뿐(옛 주소 → 새 주소, service-move.test.js가 따로 지킴)
  const afterMove = html.slice(html.indexOf('</script>'));
  check('로그인이 location을 바꾸지 않음(리다이렉트 코드 없음 — 주소 이전 스크립트 제외)',
    html.indexOf('location.href=') < 0 && afterMove.indexOf('location.replace(') < 0 &&
    html.indexOf('location.replace(') < html.indexOf('</script>'));
  check('_enterDashboard가 로그인 후 해시로 라우팅', /_enterDashboard[\s\S]{0,600}_routeFromHash\(\)/.test(html));
}

console.log('\n[11] calOpen 정리가 다른 쿼리를 지우지 않음');
{
  const { ctx } = loadFrontend(PROJ, null, { search: '?embed=1&calOpen=a,b', runHeadScripts: true });
  ctx.location.hash = '#calendar';
  const keys = ctx._migrateLegacyCalOpen();
  const url = ctx.history._urls[ctx.history._urls.length - 1];
  check('calOpen 값은 읽어옴', JSON.stringify(keys) === JSON.stringify(['a', 'b']), keys);
  check('calOpen은 주소에서 제거', url.indexOf('calOpen') < 0, url);
  check('embed=1은 살아남음', url.indexOf('embed=1') >= 0, url);
  check('해시도 보존', url.indexOf('#calendar') >= 0, url);
}

console.log('\n[12] 새로 만들어지는 주소는 ASCII 슬러그 (한글은 별칭으로만 수용)');
{
  // 맵을 직접 보지 않고 "사이드바를 눌렀을 때 주소창에 실제로 찍히는 값"으로 확인한다 —
  // 사용자가 복사하게 되는 건 결국 그 주소이기 때문.
  [['플렌더', 'TheFlender'], ['시프트', 'TheShift'], ['에어드라이', 'TheAirDry']].forEach(([prod, slug]) => {
    const { ctx } = loadFrontend(PROJ, null, { search: '?embed=1', runHeadScripts: true });
    ctx.navPage = () => {}; ctx.renderSubTabs = () => {}; ctx.render = () => {};
    ctx.navSales(null, prod);
    const url = ctx.history._urls[ctx.history._urls.length - 1];
    check(prod + ' 메뉴 → #product-' + slug, url === '/?embed=1#product-' + slug, url);
    check('  ↳ 한글 슬러그를 만들지 않음', !/[가-힣]/.test(url), url);
  });
}

console.log('\n[13] 임베드 로그인 — 팝업 방식 확인 + 차단 시 새 탭 탈출구');
{
  check('GIS가 팝업 방식(ux_mode:popup) — 리다이렉트 아님', /ux_mode\s*:\s*'popup'/.test(html));
  check('리다이렉트용 login_uri를 쓰지 않음', html.indexOf('login_uri') < 0);

  const { ctx } = loadFrontend(PROJ, null, { search: '?embed=1', runHeadScripts: true });
  // 표시 상태를 관찰할 수 있게 요소별 스텁을 심는다
  const els = {};
  ctx.document.getElementById = id => (els[id] = els[id] || { style: {}, textContent: '' });
  ctx._showLoginDiag('팝업 차단');
  check('임베드에서 새 탭 버튼 노출', els.loginDiagNewTab.style.display === 'inline-block', els.loginDiagNewTab.style.display);

  let opened = null;
  ctx.window.open = (u) => { opened = u; };
  ctx.location.hash = '#product-TheShift';
  ctx._openLoginInNewTab();
  check('새 탭 URL에서 embed 제거', opened.indexOf('embed') < 0, opened);
  check('보던 페이지(해시) 유지', opened.indexOf('#product-TheShift') >= 0, opened);
  check('대시보드 원본 주소(새 서비스 주소)', opened.indexOf('minix-offline-dashboard.onrender.com/') >= 0, opened);
}
{
  // 일반 모드에서는 같은 주소를 새 탭에 열어봤자 의미가 없으므로 버튼을 내보내지 않는다
  const { ctx } = loadFrontend(PROJ, null, { search: '', runHeadScripts: true });
  const els = {};
  ctx.document.getElementById = id => (els[id] = els[id] || { style: {}, textContent: '' });
  ctx._showLoginDiag('팝업 차단');
  check('일반 모드에서는 새 탭 버튼 숨김', els.loginDiagNewTab.style.display === 'none', els.loginDiagNewTab.style.display);
}
{
  // embed 외 다른 쿼리는 새 탭 주소에도 남아야 한다
  const { ctx } = loadFrontend(PROJ, null, { search: '?embed=1&foo=bar', runHeadScripts: true });
  let opened = null;
  ctx.window.open = (u) => { opened = u; };
  ctx._openLoginInNewTab();
  check('embed만 빼고 나머지 쿼리는 유지', opened.indexOf('foo=bar') >= 0 && opened.indexOf('embed') < 0, opened);
}

console.log('\n[14] 임베드 로그인 화면은 간결하게');
{
  const css = html.slice(0, html.indexOf('</style>'));
  check('설명 문구 숨김', css.indexOf('html.embed .login-desc{display:none}') > 0);
  check('카드 폭 축소', /html\.embed \.login-card\{width:min\(/.test(css));
  check('로그인 화면 자체는 셸 바깥(사이드바 없음)', html.indexOf('<div id="loginScreen">') < html.indexOf('<div class="app-shell"'));
}

console.log('\n[15] 회고 에디터 — 번들 로드 경합 (임베드에서 드러난 기존 버그)');
{
  /* review.js는 defer라 문서 파싱 후에 실행되는데, 부트스트랩(_enterDashboard→_routeFromHash)은
     파싱 중에 동기로 돈다. 그래서 #review로 바로 들어오면 번들보다 먼저 마운트를 시도한다.
     사이드바가 있던 시절엔 클릭으로 들어가서 가려졌지만, 임베드는 직접 URL이 유일한 진입로다. */
  const { ctx } = loadFrontend(PROJ, null, { search: '?embed=1', runHeadScripts: true });
  const host = { innerHTML: '' };
  ctx.document.getElementById = id => (id === 'reviewRoot' ? host : { style: {}, textContent: '', classList: { add(){}, remove(){}, contains: () => false } });

  // ① 번들이 아직 안 온 상태에서 마운트 시도 → "실패"가 아니라 "불러오는 중"
  delete ctx.window.ReviewApp;
  ctx._mountReviewApp();
  check('로딩 중에는 실패 메시지를 내지 않음', host.innerHTML.indexOf('불러오지 못했습니다') < 0, host.innerHTML);
  check('로딩 중 안내 표시', host.innerHTML.indexOf('불러오는 중') >= 0, host.innerHTML);

  // ② 번들이 도착하면 자동으로 마운트된다(사용자가 새로고침할 필요 없음)
  let mounted = null;
  ctx.window.ReviewApp = { mount: (el) => { mounted = el; }, unmount: () => {} };
  ctx._reviewBundleLoaded();
  check('번들 도착 시 자동 마운트', mounted === host, mounted === host);

  // ③ 기다리는 동안 다른 페이지로 떠났으면 나중에 마운트하지 않는다
  const { ctx: c2 } = loadFrontend(PROJ, null, { search: '?embed=1', runHeadScripts: true });
  const host2 = { innerHTML: '' };
  c2.document.getElementById = id => (id === 'reviewRoot' ? host2 : { style: {}, textContent: '', classList: { add(){}, remove(){}, contains: () => false } });
  delete c2.window.ReviewApp;
  c2._mountReviewApp();
  c2._unmountReviewApp();            // 다른 페이지로 이동
  let mounted2 = null;
  c2.window.ReviewApp = { mount: () => { mounted2 = true; }, unmount: () => {} };
  c2._reviewBundleLoaded();
  check('떠난 뒤에는 마운트하지 않음', mounted2 === null, mounted2);

  // ④ 진짜 로드 실패는 실패로 보여준다
  const { ctx: c3 } = loadFrontend(PROJ, null, { search: '?embed=1', runHeadScripts: true });
  const host3 = { innerHTML: '' };
  c3.document.getElementById = id => (id === 'reviewRoot' ? host3 : { style: {}, textContent: '', classList: { add(){}, remove(){}, contains: () => false } });
  delete c3.window.ReviewApp;
  c3._mountReviewApp();
  c3._reviewBundleFailed(new Error('net'));
  check('로드 실패 시 실패 메시지', host3.innerHTML.indexOf('불러오지 못했습니다') >= 0, host3.innerHTML);

  // ⑤ 마운트 자체가 던지면 원인을 화면과 콘솔에 남긴다(예전엔 뭉개져 원인이 안 보였음)
  const { ctx: c4 } = loadFrontend(PROJ, null, { search: '?embed=1', runHeadScripts: true });
  const host4 = { innerHTML: '' };
  c4.document.getElementById = id => (id === 'reviewRoot' ? host4 : { style: {}, textContent: '', classList: { add(){}, remove(){}, contains: () => false } });
  c4.window.ReviewApp = { mount: () => { throw new Error('부트 실패 상세'); }, unmount: () => {} };
  let logged = '';
  c4.console = { log(){}, warn(){}, error(...a){ logged += a.map(String).join(' '); } };
  c4._mountReviewApp();
  check('마운트 예외가 밖으로 새지 않음', true);
  check('실제 에러 메시지를 화면에 노출', host4.innerHTML.indexOf('부트 실패 상세') >= 0, host4.innerHTML);
  check('콘솔에도 실제 에러 기록', logged.indexOf('부트 실패 상세') >= 0, logged);
}

console.log('\n[16] 임베드가 숨기는 요소를 회고 에디터가 참조하지 않음');
{
  // 임베드에서 display:none 되는 것: .sidebar / .sb-backdrop / .hdr (DOM에는 남아 있음)
  const css = html.slice(0, html.indexOf('</style>'));
  check('임베드는 요소를 지우지 않고 숨기기만 함(참조해도 null이 아님)',
    /html\.embed[^{]*\{display:none\}/.test(css.replace(/\n/g, ' ')));
  // 회고 마운트 경로가 셸 요소를 참조하지 않는지 — 참조하면 임베드에서 높이/위치가 0이 된다
  const mountFn = html.slice(html.indexOf('function _mountReviewApp'), html.indexOf('function _unmountReviewApp'));
  ['hdr', 'sidebar', 'app-main', 'app-shell', 'innerHeight'].forEach(t =>
    check('마운트 코드가 ' + t + '를 참조하지 않음', mountFn.indexOf(t) < 0));
}

console.log('\n[17] DOM 참조 무결성 — 코드가 부르는 id가 실제로 존재하는가');
{
  /* ⚠ 이 검사가 있는 이유: 테스트 샌드박스의 getElementById는 어떤 id에도 스텁을 돌려주기 때문에,
     "마크업에서 지운 요소를 코드가 아직 참조하는" 실수를 절대 잡지 못한다. 실제로 2026-09-15에
     mChannelId를 mIgId/mYtId로 교체하면서 참조 두 곳이 남아, 공구건 상세 모달이 열리는 즉시
     null.placeholder로 던지며 **모든 페이지에서 모달이 안 열렸다**. 런타임 스텁으로는 못 잡으니
     마크업을 직접 대조하는 정적 검사로 막는다. */
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  const ids = new Set();
  for (const m of scripts.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) ids.add(m[1]);
  for (const m of scripts.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)) ids.add(m[1]);
  const missing = [...ids].filter(id => html.indexOf('id="' + id + '"') < 0);
  check('getElementById로 참조하는 id를 실제로 수집함(' + ids.size + '개)', ids.size > 100, ids.size);
  check('마크업에 없는 id를 참조하지 않음', missing.length === 0, missing);

  // 이번 회귀의 구체적 고정 — 교체 전 id가 코드 어디에도 남아 있으면 안 된다
  const codeOnly = scripts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // 단어 경계로 본다 — 부분 문자열로 세면 다른 식별자(예: ...ChannelIdInput)에 걸려 오탐이 난다
  check('제거된 mChannelId를 코드가 더 이상 참조하지 않음', !/mChannelId/.test(codeOnly));
  check('새 입력칸 mIgId/mYtId가 마크업에 존재',
    html.indexOf('id="mIgId"') > 0 && html.indexOf('id="mYtId"') > 0);
}

console.log('\n[18] 공구건 상세 모달이 열리는 경로가 끊기지 않는가');
{
  /* openM → _openRegisteredModal 전체를 실제로 태운다. DOM은 스텁이지만, 이 경로에서
     "정의되지 않은 함수 호출"이나 로직 예외가 나면 여기서 잡힌다. */
  const { ctx, X } = loadFrontend(PROJ, null, { search: '', runHeadScripts: true });
  const DATA = X.DATA;
  DATA.splice(0, DATA.length, ...ctx.adaptGAS({ purchases: [
    { id:3, dealId:'D1', brand:'Minix', product:'더 플렌더', channel:'채널A', platform:'인스타그램',
      link:'https://www.instagram.com/minnie.life', start:'2026-01-10', end:'2026-01-15',
      status:'완료', qty:10, sale:1000, revenue:10000, codes:['C1'], rowCount:1, tierRows:[[3,'','']] }
  ], calendarEvents: [] }));
  ctx.invalidateChannelInfo();
  let opened = null;
  const realOpen = ctx._openRegisteredModal;
  ctx._openRegisteredModal = d => { opened = d; return realOpen(d); };
  let threw = null;
  try { ctx.openM('D1', null); } catch (e) { threw = e; }
  check('모달 열기 경로가 예외 없이 끝남', threw === null, threw && threw.message);
  check('해당 공구건으로 열림', opened && opened.dealId === 'D1', opened && opened.dealId);

  // 저장 중 잠금이 걸린 건은 열리지 않아야 하고, 풀리면 다시 열려야 한다
  opened = null;
  X.savingDeals.set('D1', { at: Date.now() }); // at이 있어야 유효한 잠금
  ctx.showToast = () => {};
  ctx.openM('D1', null);
  check('저장 중에는 열지 않음', opened === null);
  X.savingDeals.delete('D1');
  ctx.openM('D1', null);
  check('잠금 해제 후 다시 열림', opened && opened.dealId === 'D1');
}

console.log('\n[19] 채널 정보 레이아웃 — 3열 그리드 3행');
{
  const chSec = html.slice(html.indexOf('<div class="f-sec has-hint">채널 정보'));
  const modalSec = chSec.slice(0, chSec.indexOf('</div>\n        <div class="fg fg-3"', 200) + 4000);
  /* 채널 안내 문구는 모달 + 등록 폼 두 곳. f-sec-hint 자체는 다른 섹션(실적 안내 등)도 쓰므로
     문구로 센다 — 전체 개수를 세면 무관한 섹션이 늘 때마다 여기가 깨진다. */
  const hintUses = (html.match(/플랫폼 ID·팔로워 수는 같은 채널의 다른 공구건에도 함께 반영됩니다/g) || []).length;
  check('안내 문구가 섹션마다 한 번씩(모달+등록 폼)', hintUses === 2, hintUses);
  check('안내 문구 내용', html.indexOf('플랫폼 ID·팔로워 수는 같은 채널의 다른 공구건에도 함께 반영됩니다') > 0);
  check('필드별 "채널 공통" 뱃지 제거', html.indexOf('채널 공통') < 0);
  check('"기준 ?" 뱃지 제거', html.indexOf('기준 ?') < 0);
  check('5열 그리드가 남아 있지 않음', html.indexOf('class="fg fg-5"') < 0);
  check('4열 그리드도 3열로 통일', html.indexOf('class="fg fg-4"') < 0);
  check('채널명은 2칸 폭', /class="f-grp span2">\s*<label class="f-lbl">채널명/.test(html));
  check('등급 상태 박스가 2칸 폭으로 그리드 안에', /class="f-grp span2">\s*<label class="f-lbl">등급 상태/.test(html));
  check('span2 CSS 정의', html.indexOf('.fg .span2{grid-column:span 2}') > 0);
  check('라벨 줄바꿈 금지 CSS', html.indexOf('.f-lbl{white-space:nowrap}') > 0);
  check('모달 본문 스크롤 유지', /\.sch-modal-wide\{[^}]*max-height:88vh;overflow-y:auto/.test(html));
  // 모달과 등록 폼 둘 다 같은 구조여야 한다
  ['mIgId','mYtId','mFollowers','mTier','mTierAuto','fIgId','fYtId','fFollowers','fTier','fTierAuto']
    .forEach(id => check(id + ' 존재', html.indexOf('id="' + id + '"') > 0));
}

console.log('\n[20] 플랫폼에 따라 필수(*) 표시가 옮겨감');
{
  const { ctx } = loadFrontend(PROJ, null, { search: '', runHeadScripts: true });
  const els = {};
  ctx.document.getElementById = id => (els[id] = els[id] || { style: {}, value: '', placeholder: '', classList: { add(){}, remove(){}, contains: () => false } });
  const shown = id => els[id] && els[id].style.display !== 'none';

  ctx._syncPlatformIdMarks('m', '인스타그램');
  check('인스타 선택 → IG 필수', shown('mIgReq') && !shown('mIgOpt'), [els.mIgReq.style.display, els.mIgOpt.style.display]);
  check('인스타 선택 → YT 선택', !shown('mYtReq') && shown('mYtOpt'));

  ctx._syncPlatformIdMarks('m', '유튜브');
  check('유튜브로 바꾸면 필수가 YT로 이동', shown('mYtReq') && !shown('mIgReq'), [els.mYtReq.style.display, els.mIgReq.style.display]);
  check('유튜브 선택 → IG는 선택 표시', shown('mIgOpt') && !shown('mYtOpt'));

  ctx._syncPlatformIdMarks('m', '기타');
  check('기타/미선택이면 둘 다 선택', !shown('mIgReq') && !shown('mYtReq') && shown('mIgOpt') && shown('mYtOpt'));

  ctx._syncPlatformIdMarks('f', '유튜브');
  check('등록 폼도 같은 규칙', shown('fYtReq') && !shown('fIgReq'));
}

console.log('\n[21] 월 필드 — 시작일에서 자동 계산');
{
  const { ctx } = loadFrontend(PROJ, null, { search: '', runHeadScripts: true });
  const els = {};
  ctx.document.getElementById = id => (els[id] = els[id] || { value: '', style: {}, classList: { add(){}, remove(){}, contains: () => false } });

  els.mStart = { value: '2026-04-06', style: {}, classList: { add(){}, remove(){} } };
  els.mEnd = { value: '2026-04-08', style: {}, classList: { add(){}, remove(){} } };
  ctx.mOnDateChange();
  check('모달 연 = 2026', els.mYear.value === 2026, els.mYear.value);
  check('모달 월 = 4 (select value와 같은 형식의 문자열)', els.mMonth.value === '4', els.mMonth.value);

  els.fStart = { value: '2026-11-02', style: {}, classList: { add(){}, remove(){} } };
  els.fEnd = { value: '2026-11-05', style: {}, classList: { add(){}, remove(){} } };
  ctx.onDateChange();
  check('등록 폼 월 = 11', els.fMonth.value === '11', els.fMonth.value);
  check('등록 폼 연 = 2026', els.fYear.value === 2026, els.fYear.value);

  // 옵션 value가 '4월'이나 4(숫자)가 아니라 '4' 문자열이어야 select가 매칭된다
  check('월 옵션 value 형식이 숫자 문자열', html.indexOf('<option value="4">4월</option>') > 0);
}

console.log('\n[22] 저장 검증 실패가 화면에 남는가');
{
  const { ctx, X } = loadFrontend(PROJ, null, { search: '', runHeadScripts: true });
  const els = {}, created = [];
  const mkEl = id => ({
    id, value: '', style: {}, className: '',
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); } },
    closest: () => ({ querySelector: () => null, appendChild: e => created.push(e) }),
    parentElement: { querySelector: () => null, appendChild: e => created.push(e) },
    focus(){}
  });
  ctx.document.getElementById = id => (els[id] = els[id] || mkEl(id));
  ctx.document.createElement = () => ({ className: '', textContent: '' });
  ctx.document.querySelectorAll = () => [];
  els.schOv = Object.assign(mkEl('schOv'), { querySelectorAll: () => [] });

  ctx._showSaveErrors('m', [{ id: 'mMonth', msg: '월을 선택해주세요' }]);
  check('해당 필드에 오류 표시(f-err)', els.mMonth.classList.contains('f-err'));
  check('필드 아래 이유 문구 생성', created.length === 1 && created[0].textContent === '월을 선택해주세요', created);
  check('저장 버튼 옆 요약 노출', els.mSaveErr.textContent === '월을 선택해주세요' && els.mSaveErr.style.display === '',
    [els.mSaveErr.textContent, els.mSaveErr.style.display]);

  // 여러 건이면 요약에 모두 나열
  ctx._showSaveErrors('m', [{ id: 'mMonth', msg: '월을 선택해주세요' }, { id: 'mStart', msg: '시작일을 입력해주세요' }]);
  check('여러 건은 요약에 함께 표시',
    els.mSaveErr.textContent.indexOf('월을 선택해주세요') > 0 && els.mSaveErr.textContent.indexOf('시작일') > 0,
    els.mSaveErr.textContent);

  // 필드와 무관한 실패도 같은 자리에
  ctx._showSaveSummary('m', '저장 실패: 헤더를 찾을 수 없습니다');
  check('서버 오류도 모달에 남음', els.mSaveErr.textContent.indexOf('헤더를 찾을 수 없습니다') > 0, els.mSaveErr.textContent);

  // 조용히 return 하던 alert 검증이 사라졌는지
  // 저장 경로 전체에서 alert를 쓰지 않는다 — 닫는 순간 단서가 사라지므로 전부 화면에 남기는 방식으로 바꿨다
  /* 검증 + 실서버 저장 구간에는 alert를 쓰지 않는다 — 닫는 순간 단서가 사라지므로 전부 화면에 남긴다.
     (그 뒤의 샘플 모드 분기는 GAS URL이 없을 때의 성공 안내라 alert 그대로 둔다 — 실패 경로가 아님) */
  const saveStart = html.indexOf('async function saveSchemeModal');
  const sampleBranch = html.indexOf('alert(\'샘플 모드', saveStart);
  const save = html.slice(saveStart, sampleBranch);
  check('모달 검증·저장 구간에 alert 없음', save.indexOf('alert(') < 0, save.match(/alert\([^)]*\)/g));
}

console.log('\n[23] 저장 잠금이 영구히 남지 않는가');
{
  const { ctx, X } = loadFrontend(PROJ, null, { search: '', runHeadScripts: true });
  X.savingDeals.set('STUCK', { at: Date.now() - 120000 }); // 2분 전에 걸린 잠금
  check('오래된 잠금은 자동 해제', ctx.isDealSaving('STUCK') === false);
  check('해제되면 목록에서도 제거', X.savingDeals.has('STUCK') === false);
  X.savingDeals.set('FRESH', { at: Date.now() });
  check('방금 걸린 잠금은 유지', ctx.isDealSaving('FRESH') === true);
  check('상한이 정의돼 있음', html.indexOf('SAVE_LOCK_MAX_MS') > 0);
}
console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
