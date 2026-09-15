/* 임베드 모드(?embed=1) 검증.

   지키려는 성질:
     · ?embed=1 이면 첫 페인트 전에 html.embed 클래스가 붙는다(늦게 붙으면 사이드바가 깜빡임)
     · 그 클래스가 실제로 사이드바·헤더를 숨기고 본문 여백을 0으로 만드는 CSS와 연결돼 있다
     · 내부 메뉴 이동(_setHash) 후에도 ?embed=1 이 URL에 남는다  ← 실제로 있었던 버그
     · embed가 없거나 다른 값이면 평소대로 동작한다
     · Render 응답 헤더가 iframe 임베드를 허용하도록 설정돼 있다

   실행: node tests/embed.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path');
const { loadFrontend } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const html = fs.readFileSync(path.join(PROJ, 'index.html'), 'utf8');

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
  check('로그인이 location을 바꾸지 않음(리다이렉트 코드 없음)',
    html.indexOf('location.href=') < 0 && html.indexOf('location.replace(') < 0);
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
console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
