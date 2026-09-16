/* 자체 세션 인증(GAS) — 구글 로그인은 신원 확인 1회, 이후는 우리가 서명한 세션 토큰.

   왜 바꿨나(2026-09-16): 예전 구조는 구글 ID 토큰을 **서명 검증 없이** base64 디코드만 해서
   exp/email/hd를 읽었다. 웹앱이 익명 접근 가능하고 /exec 주소가 공개 HTML에 박혀 있으므로,
   아무나 페이로드를 지어내 시트 전체를 읽고 쓸 수 있었다. 이 스위트의 [2]가 그 구멍이
   다시 열리지 않는지 지키는 자리다.

   지키려는 성질:
     · 서명이 틀리거나 위조된 토큰은 무조건 거부. 페이로드만 바꿔치기해도 거부
     · 비밀키가 없으면 "조용히 통과"가 아니라 예외 — 인증에서 가장 위험한 실패 방식이다
     · 시트가 진실의 원천 — 로그아웃한 세션은 서명이 멀쩡해도 즉시 거부
     · 절대 만료(12h) / 미사용 만료(2h) / 슬라이딩 연장(6h 미만 남으면 새 토큰)
     · 구글 ID 토큰은 aud·iss·email_verified·hd를 전부 확인. 하나라도 어긋나면 로그인 거부
     · 허용 목록(_allowed_users)에 없으면 도메인이 맞아도 거부
     · lastSeenAt 쓰기는 1분에 한 번만(요청마다 쓰지 않는다)
     · 로그에 토큰 값이 남지 않는다

   실행: node tests/session-auth.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeSheet, installGlobals, STATS, resetStats } = require(path.join(__dirname, 'lib', 'mock-sheets.js'));
const BASE_HEADERS = require(path.join(__dirname, 'lib', 'real-headers.js'));

const GAS_PATH = process.argv[2] || path.join(__dirname, '..', 'apps-script.js');
const SECRET = 'test-secret-v1-0123456789';
const CLIENT_ID = '379680980952-vcvtnv1le4lmma2f0gv6snita17ve7bd.apps.googleusercontent.com';
// 기본 로그인 계정은 관리자 — _allowed_users가 자동 생성될 때 관리자만 시드되기 때문이다
const ADMIN_EMAIL = 'p_dh_3678@athomecorp.com';

let pass = 0, fail = 0;
function check(l, c, extra) {
  if (c) { pass++; console.log('  PASS  ' + l); }
  else { fail++; console.log('  FAIL  ' + l + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

// tokeninfo 응답 흉내 — 기본은 정상 토큰, over로 클레임을 하나씩 망가뜨려 본다
function tokenInfoMock(over, code) {
  return () => ({
    getResponseCode: () => (code || 200),
    getContentText: () => JSON.stringify(Object.assign({
      aud: CLIENT_ID, iss: 'https://accounts.google.com',
      email: ADMIN_EMAIL, email_verified: 'true',
      hd: 'athomecorp.com', name: '관리자',
      exp: String(Math.floor(Date.now() / 1000) + 3600)
    }, over || {}))
  });
}

/* ⚠ installGlobals는 node의 **전역**을 갈아끼우므로 load()를 또 부르면 앞서 만든 컨텍스트의
   비밀키·목까지 같이 바뀐다. 두 비밀키를 비교하는 테스트는 반드시 load 순서를 의식할 것. */
function load(opts) {
  opts = opts || {};
  const sheets = opts.sheets || {};
  // 인증을 통과한 뒤 본 경로가 '데이터 시트 없음'으로 죽지 않도록 헤더만 있는 실적통합을 둔다
  if (!sheets['실적통합']) sheets['실적통합'] = makeSheet('실적통합', [[], BASE_HEADERS.slice()]);
  const logs = [];
  installGlobals(sheets, {
    scriptProps: opts.scriptProps !== undefined ? opts.scriptProps : { SESSION_SECRET_V1: SECRET },
    urlFetch: opts.urlFetch || tokenInfoMock()
  });
  global.Logger = { log: m => logs.push(String(m)) };
  const ctx = vm.createContext(global);
  vm.runInContext(fs.readFileSync(GAS_PATH, 'utf8'), ctx, { filename: 'apps-script.js' });
  ctx.__logs = logs;
  ctx.__sheets = sheets;
  return ctx;
}
// doGet은 ContentService 목이 문자열을 그대로 돌려주므로 JSON.parse로 읽는다
const call = (ctx, params) => JSON.parse(ctx.doGet({ parameter: params || {} }));
const sessionRows = ctx => {
  const sh = ctx.__sheets['_sessions'];
  if (!sh) return [];
  return sh._grid.slice(1).filter(r => r && r[0]);
};
// 로그인해서 세션 토큰 하나를 받아온다
function loginToken(ctx) {
  const r = call(ctx, { action: 'login', idToken: 'google-id-token' });
  if (!r.sessionToken) throw new Error('로그인 실패: ' + JSON.stringify(r));
  return r.sessionToken;
}

console.log('\n[1] 로그인 — 구글 ID 토큰 검증 후 세션 발급');
{
  const ctx = load();
  const r = call(ctx, { action: 'login', idToken: 'google-id-token' });
  check('세션 토큰 발급', typeof r.sessionToken === 'string' && r.sessionToken.split('.').length === 2, r);
  check('사용자 정보 반환', r.user && r.user.email === ADMIN_EMAIL, r.user);
  check('_sessions 시트에 1행 기록', sessionRows(ctx).length === 1, sessionRows(ctx));
  check('_allowed_users 시트가 자동 생성됨', !!ctx.__sheets['_allowed_users']);
  check('절대 만료가 12시간 뒤', Math.abs(r.expiresAt - Date.now() - 12 * 3600 * 1000) < 5000, r.expiresAt);

  // 로그인 액션은 세션 없이 통과해야 한다(세션을 받으러 오는 요청이므로)
  check('로그인은 세션 없이 호출 가능', !r.error, r.error);
  const logs = ctx.__logs.join('\n');
  check('로그에 토큰 값이 없다', logs.indexOf('google-id-token') === -1, logs.slice(0, 200));
}

console.log('\n[2] 위조 차단 — 예전 구조의 구멍이 다시 열리지 않는가');
{
  const ctx = load();
  const good = loginToken(ctx);

  // 예전 구조를 그대로 재현: 페이로드만 지어낸 토큰
  const forgedPayload = Buffer.from(JSON.stringify({
    sid: 'whatever', email: 'attacker@athomecorp.com', exp: Date.now() + 9e6, kv: 1
  })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  check('서명 없이 페이로드만 지어낸 토큰 거부',
    call(ctx, { session: forgedPayload + '.' + 'aaaa' }).error === 'AUTH_REQUIRED');
  check('  사유는 badsig', call(ctx, { session: forgedPayload + '.aaaa' }).reason === 'badsig',
    call(ctx, { session: forgedPayload + '.aaaa' }).reason);

  // 정상 토큰의 서명은 그대로 두고 페이로드만 바꿔치기
  const swapped = forgedPayload + '.' + good.split('.')[1];
  check('정상 서명에 남의 페이로드를 붙여도 거부', call(ctx, { session: swapped }).reason === 'badsig');

  // 서명 1글자 변조
  const sig = good.split('.')[1];
  const tweaked = good.split('.')[0] + '.' + (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  check('서명 1글자만 바꿔도 거부', call(ctx, { session: tweaked }).reason === 'badsig');

  check('토큰 없이 조회 거부', call(ctx, {}).reason === 'missing');
  check('형식이 깨진 토큰 거부', call(ctx, { session: 'not-a-token' }).reason === 'malformed');
  check('정상 토큰은 통과', !call(ctx, { session: good }).error, call(ctx, { session: good }).error);

  // 다른 비밀키로 서명된 토큰(= 키 교체 후 구 토큰, 또는 남이 만든 토큰).
  // load()가 전역을 갈아끼우므로, foreign을 뽑은 뒤 원래 비밀키로 다시 로드해서 검증한다.
  const other = load({ scriptProps: { SESSION_SECRET_V1: 'a-different-secret' } });
  const foreign = loginToken(other);
  const back = load();
  check('다른 비밀키로 서명된 토큰 거부', call(back, { session: foreign }).reason === 'badsig',
    call(back, { session: foreign }));
}

console.log('\n[3] 비밀키가 없으면 조용히 통과하지 않는다');
{
  const ctx = load({ scriptProps: {} });
  let threw = null;
  try { ctx._signSessionToken({ sid: 'x', email: 'a@b.c', exp: Date.now() + 1000, kv: 1 }); }
  catch (e) { threw = e; }
  check('서명 시 예외', threw !== null && /SESSION_SECRET_V1/.test(threw.message), threw && threw.message);

  // 검증 경로에서는 예외를 삼키되 **거부**로 끝나야 한다(통과가 아니라)
  const v = ctx._verifySessionToken('aaa.bbb');
  check('검증은 거부로 끝난다(통과 아님)', v.ok === false, v);
}

console.log('\n[4] 시트가 진실의 원천 — 로그아웃하면 서명이 멀쩡해도 거부');
{
  const ctx = load();
  const token = loginToken(ctx);
  check('로그아웃 전에는 통과', !call(ctx, { session: token }).error);

  const out = call(ctx, { action: 'logout', session: token });
  check('로그아웃 성공', out.success === true, out);
  check('_sessions에서 행이 지워짐', sessionRows(ctx).length === 0, sessionRows(ctx));
  const after = call(ctx, { session: token });
  check('같은 토큰으로 다시 요청하면 거부', after.error === 'AUTH_REQUIRED', after);
  check('  사유는 revoked', after.reason === 'revoked', after.reason);
}

console.log('\n[5] 만료 규칙 — 절대 12시간 / 미사용 2시간');
{
  // 절대 만료: 시트의 expiresAt을 과거로 돌린다
  const ctx = load();
  const token = loginToken(ctx);
  const sh = ctx.__sheets['_sessions'];
  sh._grid[1][4] = Date.now() - 1000;                    // expiresAt
  const r = call(ctx, { session: token });
  check('절대 만료된 세션 거부', r.reason === 'expired', r);

  // 미사용 만료: expiresAt은 넉넉한데 lastSeenAt이 2시간 넘게 과거
  const ctx2 = load();
  const t2 = loginToken(ctx2);
  const sh2 = ctx2.__sheets['_sessions'];
  sh2._grid[1][5] = Date.now() - (2 * 3600 * 1000 + 60000); // lastSeenAt
  const r2 = call(ctx2, { session: t2 });
  check('2시간 미사용 세션 거부', r2.reason === 'idle', r2);

  // 경계: 1시간 59분 미사용은 살아 있어야 한다
  const ctx3 = load();
  const t3 = loginToken(ctx3);
  ctx3.__sheets['_sessions']._grid[1][5] = Date.now() - (119 * 60 * 1000);
  check('1시간 59분 미사용은 통과', !call(ctx3, { session: t3 }).error);
}

console.log('\n[6] 슬라이딩 연장 — 남은 절대 만료가 6시간 미만이면 새 토큰');
{
  const ctx = load();
  const token = loginToken(ctx);

  // 갓 발급된 토큰은 12시간 남았으므로 연장하지 않는다
  const fresh = call(ctx, { session: token });
  check('막 발급된 세션은 새 토큰을 주지 않는다', !fresh.sessionToken, fresh.sessionToken);

  // 남은 시간을 5시간으로 줄이면 연장돼야 한다
  ctx.__sheets['_sessions']._grid[1][4] = Date.now() + 5 * 3600 * 1000;
  const slid = call(ctx, { session: token });
  check('새 토큰을 응답에 실어 준다',
    typeof slid.sessionToken === 'string' && slid.sessionToken.split('.').length === 2, slid.sessionToken);
  check('시트의 만료도 12시간 뒤로 갱신',
    Math.abs(Number(ctx.__sheets['_sessions']._grid[1][4]) - Date.now() - 12 * 3600 * 1000) < 5000,
    ctx.__sheets['_sessions']._grid[1][4]);
  check('새 토큰으로도 정상 통과', !call(ctx, { session: slid.sessionToken }).error);
  check('새 토큰의 sid는 그대로(같은 세션의 연장이다)',
    JSON.parse(Buffer.from(slid.sessionToken.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sid ===
    JSON.parse(Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sid);
}

console.log('\n[7] lastSeenAt 갱신은 1분에 한 번만');
{
  const ctx = load();
  const token = loginToken(ctx);
  const sh = ctx.__sheets['_sessions'];

  sh._grid[1][5] = Date.now() - 5000;  // 5초 전에 이미 갱신됨
  resetStats();
  call(ctx, { session: token });
  const wrote5s = sh._calls.filter(c => c.op === 'setValue').length;
  check('5초 전 갱신이면 다시 쓰지 않는다', wrote5s === 0, sh._calls);

  sh._grid[1][5] = Date.now() - 90000; // 90초 전
  sh._calls.length = 0;
  call(ctx, { session: token });
  check('90초 지났으면 갱신한다', sh._calls.filter(c => c.op === 'setValue').length === 1, sh._calls);
}

console.log('\n[8] 구글 ID 토큰 — 클레임을 하나라도 어기면 로그인 거부');
{
  const bad = (over, expectReason, label, code) => {
    const ctx = load({ urlFetch: tokenInfoMock(over, code) });
    const r = call(ctx, { action: 'login', idToken: 'x' });
    check(label, r.error === 'LOGIN_REJECTED' && r.reason === expectReason, r);
  };
  bad({ aud: 'someone-elses-client-id.apps.googleusercontent.com' }, 'aud', 'aud가 다르면 거부(남의 사이트 토큰)');
  bad({ iss: 'https://evil.example.com' }, 'iss', 'iss가 구글이 아니면 거부');
  bad({ email_verified: 'false' }, 'unverified', '이메일 미인증이면 거부');
  bad({ hd: 'other-company.com' }, 'domain', '허용 도메인이 아니면 거부');
  bad({ hd: '' }, 'domain', 'hd가 비어 있으면 거부(개인 지메일)');
  bad({ exp: String(Math.floor(Date.now() / 1000) - 10) }, 'expired', '만료된 ID 토큰 거부');
  bad({}, 'invalid', 'tokeninfo가 200이 아니면 거부', 400);

  const ctx = load();
  check('토큰 자체가 없으면 거부',
    call(ctx, { action: 'login', idToken: '' }).reason === 'missing');
}

console.log('\n[9] 허용 목록(_allowed_users)');
{
  const allowed = makeSheet('_allowed_users', [
    ['email', '비고'],
    ['someone@athomecorp.com', ''],
  ]);
  const asSomeone = tokenInfoMock({ email: 'someone@athomecorp.com' });
  const ctx = load({ sheets: { '_allowed_users': allowed }, urlFetch: asSomeone });
  check('목록에 있으면 로그인 성공', !!call(ctx, { action: 'login', idToken: 'x' }).sessionToken);

  const other = makeSheet('_allowed_users', [['email', '비고'], ['nobody@athomecorp.com', '']]);
  const ctx2 = load({ sheets: { '_allowed_users': other }, urlFetch: asSomeone });
  const r = call(ctx2, { action: 'login', idToken: 'x' });
  check('도메인이 맞아도 목록에 없으면 거부', r.error === 'LOGIN_REJECTED' && r.reason === 'not_allowed', r);
  check('  거부 로그에 이메일은 남긴다(추적용)',
    ctx2.__logs.join('\n').indexOf('someone@athomecorp.com') >= 0);
}

console.log('\n[10] 관리자 세션 종료');
{
  const ctx = load();
  loginToken(ctx); loginToken(ctx); loginToken(ctx);
  check('세션 3건', sessionRows(ctx).length === 3, sessionRows(ctx).length);
  check('revokeAllSessions가 3건 종료', ctx.revokeAllSessions() === 3);
  check('  시트가 비었다', sessionRows(ctx).length === 0, sessionRows(ctx));

  const ctx2 = load();
  loginToken(ctx2);
  check('revokeUserSessions가 해당 이메일만 종료', ctx2.revokeUserSessions(ADMIN_EMAIL) === 1);
  check('  없는 이메일은 0건', ctx2.revokeUserSessions('nobody@athomecorp.com') === 0);
}

console.log('\n[11] 관리자 전용 엔드포인트는 세션 이메일로 판정');
{
  const allowed = makeSheet('_allowed_users', [['email', ''], ['someone@athomecorp.com', '']]);
  const ctx = load({ sheets: { '_allowed_users': allowed }, urlFetch: tokenInfoMock({ email: 'someone@athomecorp.com' }) });
  const token = loginToken(ctx);   // someone@ — ADMIN_EMAILS에 없음
  const r = call(ctx, { session: token, debug: '1' });
  check('관리자가 아니면 debug 거부', r.error === 'ADMIN_REQUIRED', r);
}

/* ────────────────────────────── 프론트 ──────────────────────────────
   프론트에서 지켜야 할 것은 하나로 요약된다: **세션 유지에 브라우저 UI가 개입하지 않는다.**
   예전 구조가 무너진 지점이 정확히 거기였다(One Tap이 안 뜨면 끝). */
const { loadFrontend } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));
const PROJ = path.join(__dirname, '..');

// fetch를 원하는 JSON으로 고정하고, 나간 요청 URL/본문을 기록한다
function frontWith(responses) {
  const { ctx, X } = loadFrontend(PROJ);
  const sent = [];
  let i = 0;
  ctx.fetch = async (url, opts) => {
    sent.push({ url: String(url), body: opts && opts.body });
    const r = Array.isArray(responses) ? (responses[Math.min(i++, responses.length - 1)]) : responses;
    return { status: 200, json: async () => r };
  };
  ctx.showToast = () => {};
  return { ctx, X, sent };
}

console.log('\n[12] 프론트 — 세션 부착과 저장');
{
  const { ctx } = frontWith({ ok: true });
  ctx._setSession('head.sig');
  check('URL에 session 파라미터를 붙인다', ctx._gasUrl('https://x/exec') === 'https://x/exec?session=head.sig',
    ctx._gasUrl('https://x/exec'));
  check('이미 있으면 교체한다(중복 부착 없음)',
    ctx._gasUrl('https://x/exec?session=old') === 'https://x/exec?session=head.sig',
    ctx._gasUrl('https://x/exec?session=old'));
  check('localStorage에 저장된다', ctx.localStorage.getItem('gp_session') === 'head.sig');
  ctx._clearSession();
  check('지우면 URL에도 안 붙는다', ctx._gasUrl('https://x/exec') === 'https://x/exec');
  check('  localStorage에서도 지워진다', ctx.localStorage.getItem('gp_session') === null);
}

console.log('\n[13] 프론트 — 슬라이딩 연장은 조용히, 401은 즉시 로그인 화면');
{
  // 응답에 새 토큰이 실려 오면 UI 개입 없이 갈아끼운다
  const a = frontWith({ ok: true, sessionToken: 'new.token' });
  a.ctx._setSession('old.token');
  a.ctx._gasFetch('https://x/exec?session=old.token', {}).then(() => {
    check('응답의 새 토큰으로 교체', a.ctx._getToken() === 'new.token', a.ctx._getToken());
    check('  localStorage에도 반영', a.ctx.localStorage.getItem('gp_session') === 'new.token');
  });

  // AUTH_REQUIRED면 세션을 버리고 로그인 화면 — **재시도하지 않는다**
  const b = frontWith({ error: 'AUTH_REQUIRED', reason: 'revoked' });
  b.ctx._setSession('dead.token');
  let shown = false;
  b.ctx._showReloginScreen = () => { shown = true; };
  b.ctx._gasFetch('https://x/exec?session=dead.token', {}).then(() => {
    check('세션을 버린다', b.ctx._getToken() === null, b.ctx._getToken());
    check('로그인 화면을 띄운다', shown === true);
    check('재시도하지 않는다(요청 1회)', b.sent.length === 1, b.sent.length);
  });
}

console.log('\n[14] 프론트 — 복원 / 로그아웃 / 하트비트');
{
  const { ctx } = frontWith({ ok: true });
  // 세션 페이로드에서 사용자 정보를 복원할 수 있어야 한다(브라우저 재시작 후 sessionStorage가 빈 경우)
  const payload = Buffer.from(JSON.stringify({ sid: 's1', email: 'a@athomecorp.com', name: '홍길동', exp: Date.now() + 1e7, kv: 1 }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const p = ctx._decodeSessionPayload(payload + '.sig');
  check('세션 페이로드에서 이메일/이름 복원', p && p.email === 'a@athomecorp.com' && p.name === '홍길동', p);
  check('망가진 토큰은 null', ctx._decodeSessionPayload('!!!') === null);

  // 구 로그인 흔적은 1회만 안내로 소비된다
  ctx.localStorage.setItem('gp_id_token', '{"token":"x"}');
  check('구 토큰 흔적이 있으면 안내 신호 1회', ctx._consumeLegacyLoginNotice() === true);
  check('  두 번째부터는 false(흔적을 지웠으므로)', ctx._consumeLegacyLoginNotice() === false);
  check('  구 토큰 캐시는 제거된다', ctx.localStorage.getItem('gp_id_token') === null);

  // 하트비트는 세션만 보낸다 — 이메일/이름을 클라이언트가 주장하지 않는다
  const h = frontWith({ success: true, users: [] });
  h.ctx._setSession('sess.tok');
  h.ctx._getGasUrl = () => 'https://x/exec';
  h.ctx._sendPresenceHeartbeat().then(() => {
    const body = h.sent.length ? String(h.sent[0].body || '') : '';
    check('하트비트 본문에 session이 실린다', body.indexOf('sess.tok') >= 0, body);
    check('  이메일/idToken은 실리지 않는다', body.indexOf('idToken') === -1 && body.indexOf('@') === -1, body);
  });
}

/* ──────────────── [15] 프론트 ↔ GAS 통합 (HTTP만 생략) ────────────────
   지금까지는 양쪽을 따로 봤다. 여기서는 **진짜 프론트 코드**가 **진짜 GAS 코드**와
   로그인 → 인증된 요청 → 슬라이딩 연장 → 로그아웃까지 한 바퀴 돈다.
   인증은 양쪽 규칙이 정확히 맞물려야 동작하므로, 한쪽만 맞는 상태를 여기서 걸러낸다. */
const _e2e = (async () => {
  console.log('\n[15] 프론트 ↔ GAS 한 바퀴');

  const mainSheet = makeSheet('실적통합', [[], BASE_HEADERS.slice()]);
  const sheets = { '실적통합': mainSheet };
  installGlobals(sheets, { scriptProps: { SESSION_SECRET_V1: SECRET }, urlFetch: tokenInfoMock() });
  global.Logger = { log: () => {} };
  const gas = vm.createContext(global);
  vm.runInContext(fs.readFileSync(GAS_PATH, 'utf8'), gas, { filename: 'apps-script.js' });

  const { ctx: front } = loadFrontend(PROJ);
  front._getGasUrl = () => 'https://example.test/exec';
  front.showToast = () => {};
  let loginScreenShown = false;
  front._showReloginScreen = () => { loginScreenShown = true; };
  front._enterDashboard = () => {};
  front.fetchLive = () => {};

  // HTTP만 직결로 대체 — 쿼리스트링을 e.parameter로 옮겨 doGet/doPost에 그대로 넣는다
  const calls = [];
  front.fetch = async (url, opts) => {
    const u = new URL(String(url));
    const parameter = {};
    u.searchParams.forEach((v, k) => { parameter[k] = v; });
    calls.push({ action: parameter.action || '(조회)', hasSession: !!parameter.session });
    const body = opts && opts.body;
    const raw = body
      ? gas.doPost({ parameter, postData: { contents: body } })
      : gas.doGet({ parameter });
    return { status: 200, json: async () => JSON.parse(raw) };
  };

  // ① 로그인 — 구글 credential을 세션으로 교환
  await front._exchangeForSession('google-credential');
  const token = front._getToken();
  check('로그인 후 프론트가 세션을 들고 있다', typeof token === 'string' && token.split('.').length === 2, token);
  check('  GAS의 _sessions에 행이 생겼다', sheets['_sessions']._grid.slice(1).filter(r => r[0]).length === 1);
  check('  교환 요청에는 세션이 실리지 않는다(아직 없으니까)', calls[0].hasSession === false, calls[0]);

  // ② 인증된 조회 — 세션이 URL에 붙고 서버가 통과시킨다
  const data = await front._gasFetch(front._gasUrl('https://example.test/exec'), {});
  check('인증된 조회가 통과한다', data.error !== 'AUTH_REQUIRED', data.error);
  check('  요청에 세션이 실렸다', calls[calls.length - 1].hasSession === true);

  // ③ 슬라이딩 연장 — 서버가 새 토큰을 실어 보내고 프론트가 조용히 갈아끼운다
  sheets['_sessions']._grid[1][4] = Date.now() + 5 * 3600 * 1000; // 남은 수명 5시간
  await front._gasFetch(front._gasUrl('https://example.test/exec'), {});
  const renewed = front._getToken();
  check('연장된 새 토큰을 받아 저장했다', typeof renewed === 'string' && renewed !== token, { before: !!token, after: !!renewed });
  check('  사용자 개입 없이 끝났다(로그인 화면 안 뜸)', loginScreenShown === false);
  const after = await front._gasFetch(front._gasUrl('https://example.test/exec'), {});
  check('  새 토큰으로도 계속 통과한다', after.error !== 'AUTH_REQUIRED', after.error);

  // ④ 하트비트(POST) — 세션으로 인증되고 서버가 신원을 직접 판단한다
  const beat = await front._gasFetch(front._gasUrl('https://example.test/exec'),
    { method: 'POST', body: JSON.stringify({ action: 'presence', session: front._getToken() }) });
  check('하트비트가 세션으로 통과한다', beat.success === true, beat);
  check('  접속자 이메일을 서버가 채운다',
    Array.isArray(beat.users) && beat.users.length === 1 && beat.users[0].email === ADMIN_EMAIL, beat.users);

  // ⑤ 로그아웃 — 서버 원장에서 지워지고, 같은 토큰은 즉시 거부된다
  const dead = front._getToken();
  await front.fetch(front._gasUrl('https://example.test/exec') + '&action=logout');
  check('로그아웃하면 _sessions가 빈다', sheets['_sessions']._grid.slice(1).filter(r => r[0]).length === 0);
  const rejected = await front._gasFetch('https://example.test/exec?session=' + encodeURIComponent(dead), {});
  check('이전 토큰으로 요청하면 거부된다', rejected.error === 'AUTH_REQUIRED' && rejected.reason === 'revoked', rejected);
  check('  프론트가 세션을 버리고 로그인 화면을 띄운다', front._getToken() === null && loginScreenShown === true);
})();

// 비동기 블록이 전부 끝난 뒤 집계한다
const _summary = () => {
  console.log('\n' + '─'.repeat(52));
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
};
_e2e.then(() => setTimeout(_summary, 30), e => { console.error("[15] 예외:", e); fail++; setTimeout(_summary, 30); });
