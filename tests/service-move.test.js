/* 서비스 주소 이전(0-B, 2026-09-26) 검증 — minix-gongu-dashboard → minix-offline-dashboard.

   지키려는 성질:
     · 이전 스크립트가 문서의 첫 스크립트다(다른 스크립트·스타일보다 먼저)
     · 옛 주소면 경로·쿼리(?embed=1)·해시를 그대로 붙여 새 주소로 location.replace
     · 새 주소·localhost·그 밖의 주소에서는 아무 일도 하지 않는다(무한 리다이렉트 방지)
     · 이동 중에는 부트스트랩이 시작하지 않는다(세션 복원·데이터 요청·replaceState가 이동을 방해하지 않게)
     · dashboard.html도 같은 스크립트를 가진다(index.html과 동일 사본)

   실행: node tests/service-move.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path');
const { loadFrontend, readFrontSource } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const html = readFrontSource(PROJ);
const OLD = 'minix-gongu-dashboard.onrender.com', NEW = 'https://minix-offline-dashboard.onrender.com';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
const SHIM = 'get moved(){return window.__SERVICE_MOVED__===true;}';
const boot = opts => loadFrontend(PROJ, SHIM, Object.assign({ runHeadScripts: true }, opts));

console.log('\n[1] 위치 — 문서의 첫 스크립트');
{
  const first = html.indexOf('<script');
  check('첫 <script>가 주소 이전 스크립트', html.slice(first, html.indexOf('</script>')).indexOf("location.hostname==='" + OLD + "'") > 0);
  check('<title>·<link>·<style>보다 앞', first < html.indexOf('<title>') && first < html.indexOf('<link') && first < html.indexOf('<style>'));
  check('dashboard.html도 같은 사본', fs.readFileSync(path.join(PROJ, 'dashboard.html'), 'utf8') === fs.readFileSync(path.join(PROJ, 'index.html'), 'utf8'));
}

console.log('\n[2] 옛 주소 → 새 주소(경로·쿼리·해시 보존)');
[
  ['/', '', '', NEW + '/'],
  ['/', '', '#calendar', NEW + '/#calendar'],
  ['/', '?embed=1', '#calendar', NEW + '/?embed=1#calendar'],
  ['/', '?embed=1&foo=bar', '#product-TheFlender', NEW + '/?embed=1&foo=bar#product-TheFlender'],
  ['/dashboard.html', '?embed=1', '#review', NEW + '/dashboard.html?embed=1#review'],
  ['/', '', '#offline/channel/ch-001', NEW + '/#offline/channel/ch-001']
].forEach(([pathname, search, hash, want]) => {
  const { ctx, X } = boot({ hostname: OLD, pathname, search, hash });
  check(`${pathname}${search}${hash || ''} → ${want}`, ctx.location._replaced === want, ctx.location._replaced);
  check('  ↳ 이동 표시(__SERVICE_MOVED__)', X.moved === true);
});

console.log('\n[3] 새 주소·localhost·그 밖 — 아무 일도 안 함');
['minix-offline-dashboard.onrender.com', 'localhost', '127.0.0.1', 'minix-workspace.onrender.com', 'gongu-dashboard.onrender.com'].forEach(h => {
  const { ctx, X } = boot({ hostname: h, search: '?embed=1', hash: '#calendar' });
  check(`${h}: 리다이렉트 없음`, ctx.location._replaced === null && X.moved === false, ctx.location._replaced);
});

console.log('\n[4] 이동 중엔 부트스트랩이 멈춤 — 세션이 있어도 옛 주소에서 진입하지 않음');
{
  const token = Buffer.from(JSON.stringify({ email: 't@athomecorp.com', name: 'T' })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.sig';
  const onOld = boot({ hostname: OLD, hash: '#calendar', localStorage: { gp_session: token } });
  check('옛 주소: 세션 복원 안 함(_getToken null)', onOld.ctx._getToken() === null, onOld.ctx._getToken());
  check('옛 주소: 주소 정리(replaceState)도 안 함', onOld.ctx.history._urls.length === 0, onOld.ctx.history._urls);
  const onNew = boot({ hostname: 'minix-offline-dashboard.onrender.com', hash: '#calendar', localStorage: { gp_session: token } });
  check('새 주소: 같은 세션이면 평소대로 복원·진입', onNew.ctx._getToken() === token && onNew.ctx.history._urls.slice(-1)[0] === '/#calendar',
    { token: onNew.ctx._getToken() === token, urls: onNew.ctx.history._urls });
}

console.log('\n' + '─'.repeat(50));
console.log('통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
