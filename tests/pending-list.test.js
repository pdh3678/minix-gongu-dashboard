/* 미기입 목록(0단계, 2026-09-25) 검증.

   지키려는 성질:
     · 메뉴 '미기입 목록', 탭 "실적 미기입" / "채널 정보 미기입"
     · 미기입 판정(pendingPerfDeals)은 전과 같다 — 판매수량·총매출이 둘 다 비었거나 0
     · 실적 미기입 탭: 진행상태는 _displayStatus 그대로, 완료 건이 맨 위(강조), 진행중·예정은 아래(흐리게),
       같은 상태 안에서는 종료일 오래된 순
     · 상태 필터 칩(완료/진행중/예정) 기본 전체 선택, 끄면 그 상태만 빠짐
     · 사이드바 배지 = 완료됐는데 실적 미기입 건수(필터와 무관), 0건이면 숨김
     · 채널 정보 미기입 탭은 상태·칩과 무관하게 전부

   실행: node tests/pending-list.test.js  (또는 node tests/run-all.js) */
const path = require('path');
const { loadFrontend, readFrontSource } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const html = readFrontSource(PROJ);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

// KST 오늘 기준 ±n일 'YYYY-MM-DD'
const KST_TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function day(n) { const d = new Date(KST_TODAY + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const deal = (id, start, end, extra) => Object.assign({ dealId: id, id, brand: 'Minix', product: '더 플렌더 PRO', ch: '채널' + id,
  platform: '인스타그램', start, end, qty: null, rev: null, s: { sale: 1000 } }, extra || {});
const DEALS = [
  deal('F2', day(10), day(12)),                       // 예정(늦게 끝남)
  deal('D2', day(-20), day(-15)),                     // 완료
  deal('P1', day(-2), day(5)),                        // 진행중
  deal('F1', day(3), day(4)),                         // 예정
  deal('D1', day(-40), day(-30)),                     // 완료(더 오래 전)
  deal('P2', day(-1), day(1)),                        // 진행중(먼저 끝남)
  deal('OK', day(-9), day(-8), { qty: 5, rev: 50000 }), // 실적 있음 → 미기입 아님
  deal('Z0', day(-7), day(-6), { qty: 0, rev: 0 })      // 0/0 → 미기입(기존 판정)
];

function fakeDom() {
  const els = {};
  const get = id => (els[id] = els[id] || { id, innerHTML: '', textContent: '', style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false } });
  return { els, get };
}
function boot() {
  const { ctx, X } = loadFrontend(PROJ, 'setMgmtStatusOn(a){_mgmtStatusOn=new Set(a);}');
  X.DATA.splice(0, X.DATA.length, ...DEALS.map(d => ({ ...d, s: { ...d.s } })));
  const dom = fakeDom();
  ctx.document.getElementById = dom.get;
  ctx.invalidateChannelInfo(); ctx.invalidateTierStats();
  return { ctx, X, dom };
}
const rowIds = bodyHtml => [...bodyHtml.matchAll(/<tr class="([^"]+)">[\s\S]*?채널(\w+)/g)].map(m => m[2]);
const rowClasses = bodyHtml => [...bodyHtml.matchAll(/<tr class="([^"]+)">/g)].map(m => m[1]);

(async () => {
  console.log('\n[1] 이름');
  const page = html.slice(html.indexOf('id="page-management"'), html.indexOf('id="mgmtChBody"'));
  check('탭: 실적 미기입 / 채널 정보 미기입',
    page.indexOf(">실적 미기입</button>") > 0 && page.indexOf(">채널 정보 미기입</button>") > 0 && page.indexOf('채널 정보 미입력') < 0);
  check('사이드바 메뉴명: 미기입 목록', html.indexOf('<span class="sb-label">미기입 목록</span>') > 0 && html.indexOf('실적 미기입 목록</span>') < 0);
  check('상태 칩 자리가 실적 미기입 탭 안에 있음', /id="mgmtPerfWrap">[\s\S]*id="mgmtStatusChips"[\s\S]*id="mgmtBody"/.test(page));

  console.log('\n[2] 미기입 판정은 그대로');
  {
    const { ctx } = boot();
    const ids = ctx.pendingPerfDeals().map(d => d.dealId);
    check('실적 있는 건(OK)은 빠지고 0/0 건(Z0)은 들어감', ids.indexOf('OK') < 0 && ids.indexOf('Z0') >= 0, ids);
    check('판정 대상 7건(상태 무관)', ids.length === 7, ids);
    check('판정 결과 순서도 전과 같음(종료일 오래된 순)',
      JSON.stringify(ids) === JSON.stringify(['D1', 'D2', 'Z0', 'P2', 'F1', 'P1', 'F2']), ids);
  }

  console.log('\n[3] 실적 미기입 탭 — 완료 위(강조), 진행중·예정 아래(흐리게)');
  {
    const { ctx, dom } = boot();
    ctx.renderMgmtPage();
    const body = dom.els.mgmtBody.innerHTML;
    check('순서: 완료(D1,D2,Z0) → 진행중(P2,P1) → 예정(F1,F2)',
      JSON.stringify(rowIds(body)) === JSON.stringify(['D1', 'D2', 'Z0', 'P2', 'P1', 'F1', 'F2']), rowIds(body));
    check('완료 행만 강조(mgmt-overdue), 나머지는 흐리게(mgmt-later)',
      JSON.stringify(rowClasses(body)) === JSON.stringify(['mgmt-overdue', 'mgmt-overdue', 'mgmt-overdue', 'mgmt-later', 'mgmt-later', 'mgmt-later', 'mgmt-later']),
      rowClasses(body));
    check('진행상태 배지는 기존 bdg(_displayStatus) 그대로', body.indexOf(ctx.bdg('완료')) > 0 && body.indexOf(ctx.bdg('예정')) > 0);
    const chips = dom.els.mgmtStatusChips.innerHTML;
    check('칩 3개 기본 전체 선택 + 건수', (chips.match(/class="mgmt-chip on"/g) || []).length === 3 &&
      chips.indexOf('완료 <span class="mgmt-chip-n">3</span>') > 0 && chips.indexOf('진행중 <span class="mgmt-chip-n">2</span>') > 0 &&
      chips.indexOf('예정 <span class="mgmt-chip-n">2</span>') > 0, chips);
    check('건수 표시(전체 선택) = 7건', dom.els.mgmtCnt.textContent === '7건', dom.els.mgmtCnt.textContent);
    check('사이드바 배지 = 완료 3건', dom.els.sbPendingBadge.textContent === '3' && dom.els.sbPendingBadge.style.display === '');
  }

  console.log('\n[4] 상태 칩 필터');
  {
    const { ctx, dom } = boot();
    ctx._toggleMgmtStatus('진행중');
    const body = dom.els.mgmtBody.innerHTML;
    check('진행중을 끄면 진행중 행만 빠짐', JSON.stringify(rowIds(body)) === JSON.stringify(['D1', 'D2', 'Z0', 'F1', 'F2']), rowIds(body));
    check('  ↳ 꺼진 칩은 on 해제', /class="mgmt-chip"[^>]*_toggleMgmtStatus\('진행중'\)/.test(dom.els.mgmtStatusChips.innerHTML));
    check('  ↳ 건수 표시 = 5건 / 전체 7건', dom.els.mgmtCnt.textContent === '5건 / 전체 7건', dom.els.mgmtCnt.textContent);
    check('  ↳ 배지는 필터와 무관하게 완료 3건', dom.els.sbPendingBadge.textContent === '3');
    ctx._toggleMgmtStatus('진행중');
    check('다시 켜면 원래대로 7행', rowIds(dom.els.mgmtBody.innerHTML).length === 7);
    ['완료', '진행중', '예정'].forEach(s => ctx._toggleMgmtStatus(s));
    check('전부 끄면 안내 문구', dom.els.mgmtBody.innerHTML.indexOf('선택한 진행상태의 실적 미기입 건이 없습니다') > 0);
  }

  console.log('\n[5] 배지 0건이면 숨김');
  {
    const { ctx, X, dom } = boot();
    X.DATA.splice(0, X.DATA.length, deal('F9', day(5), day(6)));
    ctx.renderMgmtPage();
    check('완료 미기입이 없으면 배지 숨김', dom.els.sbPendingBadge.style.display === 'none' && dom.els.sbPendingBadge.textContent === '');
    X.DATA.splice(0, X.DATA.length);
    ctx.renderMgmtPage();
    check('미기입이 하나도 없으면 기존 축하 문구', dom.els.mgmtBody.innerHTML.indexOf('실적 미기입 건이 없습니다 🎉') > 0);
  }

  console.log('\n[6] 채널 정보 미기입 탭은 상태·칩과 무관');
  {
    const { ctx, X, dom } = boot();
    ctx.renderMgmtPage();
    const all = dom.els.mgmtChBody.innerHTML;
    X.setMgmtStatusOn([]);
    ctx._setMgmtTab('chinfo');
    check('칩을 전부 꺼도 채널 목록은 같음', dom.els.mgmtChBody.innerHTML === all);
    const chCount = (all.match(/<tr>/g) || []).length;
    check('모든 미기입 채널(ID·팔로워 없음 8채널)이 상태와 무관하게 나옴', chCount === 8, chCount);
    check('건수 표시는 채널 수', dom.els.mgmtCnt.textContent === '8채널', dom.els.mgmtCnt.textContent);
  }

  console.log('\n' + '─'.repeat(50));
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})();
