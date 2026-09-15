/* 수동 묶기 — 사람이 대시보드에서 직접 공구건을 묶고 푸는 경로.

   지키려는 성질:
     · 자동 묶기 기준은 "제품·채널·시작일·종료일 완전 일치" 그대로다. 느슨하게 바꾸면 서로 다른
       공구건이 말없이 합쳐지므로, 느슨한 판단은 "후보 제안"까지만 하고 실행은 사람이 한다
     · 후보 탐지는 느슨(채널 공백·대소문자 무시, 기간 3일 이내)하지만, 실제 묶기는 채널이 정확히
       같을 때만 허용한다 — 표기가 다르면 먼저 시트에서 채널명을 맞춰야 한다
     · 제품·기간 차이는 경고만 하고 사람 판단에 맡긴다
     · 이미 묶인 건은 후보에서 빠지고 체크박스도 주지 않는다
     · 묶기 해제는 그룹ID를 각 행의 dealId로 되돌릴 뿐, 행을 지우지 않는다

   실행: node tests/group-manual.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path');
const { loadFrontend } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(l, c, extra) {
  if (c) { pass++; console.log('  PASS  ' + l); }
  else { fail++; console.log('  FAIL  ' + l + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

function deal(o) {
  const d = Object.assign({
    dealId: o.dealId, ch: o.ch, influencer: o.ch, product: o.product || '더 플렌더',
    start: o.start, end: o.end, codes: o.codes || ['C' + o.dealId], rowCount: o.rowCount || 1,
    groupId: o.groupId || o.dealId, qty: 0, rev: 0
  }, o);
  if (!d.codeRows) d.codeRows = (o.rows || [o.row]).map((ri, i) => ({ rowIndex: ri, code: d.codes[i] || 'C', qty: 0 }));
  return d;
}

// 하늘마켓 사례를 본뜬 데이터: 같은 채널에서 제품만 다른 두 건 + 기간이 살짝 어긋난 건 등
function makeData() {
  return [
    deal({ dealId: 'D1', ch: '하늘마켓', product: '더 플렌더 PRO', start: '2026-02-01', end: '2026-02-03', row: 3 }),
    deal({ dealId: 'D2', ch: '하늘마켓', product: '더 플렌더 MAX', start: '2026-02-01', end: '2026-02-03', row: 4 }),
    deal({ dealId: 'D3', ch: '하늘마켓', product: '더 플렌더 PRO', start: '2026-02-06', end: '2026-02-08', row: 5 }), // 3일 간격
    deal({ dealId: 'D4', ch: '하늘마켓', product: '더 플렌더 PRO', start: '2026-02-20', end: '2026-02-21', row: 6 }), // 멀다
    deal({ dealId: 'D5', ch: '다른채널', product: '더 플렌더 PRO', start: '2026-02-01', end: '2026-02-03', row: 7 }),
    deal({ dealId: 'D6', ch: '하늘 마켓', product: '더 플렌더 PRO', start: '2026-02-01', end: '2026-02-02', row: 8 }), // 표기만 다름
    deal({ dealId: 'D7', ch: '하늘마켓', product: '더 시프트', start: '2026-02-01', end: '2026-02-03',
      rowCount: 2, groupId: 'G-OLD', rows: [9, 10], codes: ['X1', 'X2'] }) // 이미 묶인 건
  ];
}

function setup() {
  const { ctx, X } = loadFrontend(PROJ, 'get groupSel(){return _groupSel;}');
  X.DATA.splice(0, X.DATA.length, ...makeData());
  ctx.invalidateGroupCandidates();
  const sent = [], alerts = [], toasts = [];
  ctx._getGasUrl = () => 'https://example.test/exec';
  ctx._gasWrite = async (url, action, data) => { sent.push({ action, data }); return { success: true, rows: (data.rowIndexes || []), count: 2 }; };
  ctx.alert = m => alerts.push(String(m));
  ctx.confirm = () => true;
  ctx.showToast = m => toasts.push(String(m));
  ctx.render = () => {}; ctx.fetchLive = () => {}; ctx.closeSchModal = () => {};
  return { ctx, X, sent, alerts, toasts };
}
const ids = arr => (arr || []).slice().sort().join(',');

(async () => {
  console.log('\n[1] 묶기 후보 탐지 — 제안만 하고 자동으로 합치지 않는다');
  {
    const { ctx } = setup();
    const m = ctx.groupCandidates();
    check('제품만 다른 같은 기간 건을 후보로', (m.get('D1') || []).indexOf('D2') >= 0, m.get('D1'));
    check('3일 이내로 떨어진 건도 후보로', (m.get('D1') || []).indexOf('D3') >= 0, m.get('D1'));
    check('채널 표기 차이는 같은 채널로 취급', (m.get('D1') || []).indexOf('D6') >= 0, m.get('D1'));
    check('기간이 먼 건은 후보 아님', !m.has('D4'), m.get('D4'));
    check('다른 채널은 후보 아님', !m.has('D5'), m.get('D5'));
    check('이미 묶인 건은 후보에서 제외', !m.has('D7') && (m.get('D1') || []).indexOf('D7') < 0, m.get('D1'));
    check('후보 관계는 양방향', (m.get('D2') || []).indexOf('D1') >= 0, m.get('D2'));

    check('후보 배지 노출', ctx.groupCandidateBadge({ dealId: 'D1', rowCount: 1 }).indexOf('묶기 후보') >= 0);
    check('후보 없으면 배지 없음', ctx.groupCandidateBadge({ dealId: 'D4', rowCount: 1 }) === '');
    check('묶인 건에는 배지 없음', ctx.groupCandidateBadge({ dealId: 'D7', rowCount: 2 }) === '');
  }

  console.log('\n[2] 후보 계산 캐시 — 데이터가 바뀌면 다시 계산');
  {
    const { ctx, X } = setup();
    ctx.groupCandidates();
    X.DATA.splice(0, X.DATA.length, deal({ dealId: 'Z1', ch: '새채널', start: '2026-03-01', end: '2026-03-02', row: 3 }));
    check('무효화 전에는 옛 결과', ctx.groupCandidates().has('D1'));
    ctx.invalidateGroupCandidates();
    check('무효화 후 새 데이터 반영', !ctx.groupCandidates().has('D1') && ctx.groupCandidates().size === 0);
  }

  console.log('\n[3] 목록 체크박스');
  {
    const { ctx } = setup();
    const c1 = ctx.groupSelectCell(null);
    check('빈 건은 빈 칸', c1 === '<td></td>', c1);
    const solo = ctx.groupSelectCell({ dealId: 'D1', rowCount: 1 });
    // 'checked'는 onchange의 this.checked에도 들어 있으므로 속성 자리로만 본다
    check('단독 건은 체크박스', solo.indexOf('type="checkbox"') >= 0 && solo.indexOf('checkbox" checked') < 0, solo);
    const grouped = ctx.groupSelectCell({ dealId: 'D7', rowCount: 2 });
    check('묶인 건은 체크박스 없이 묶음 표시', grouped.indexOf('checkbox') < 0 && grouped.indexOf('묶음') >= 0, grouped);
    ctx.toggleGroupSelect('D1', true);
    check('선택 상태가 체크로 반영', ctx.groupSelectCell({ dealId: 'D1', rowCount: 1 }).indexOf('checkbox" checked') >= 0,
      ctx.groupSelectCell({ dealId: 'D1', rowCount: 1 }));
    check('행 클릭(모달)으로 새지 않게 stopPropagation', solo.indexOf('stopPropagation') >= 0);
  }

  console.log('\n[4] 선택 — 시작일이 가장 빠른 건이 대표');
  {
    const { ctx, X } = setup();
    ctx.toggleGroupSelect('D3', true);
    ctx.toggleGroupSelect('D1', true);
    check('2건 선택됨', X.groupSel.size === 2, X.groupSel.size);
    const sel = ctx._selectedDeals();
    check('시작일 오름차순', sel.map(d => d.dealId).join(',') === 'D1,D3', sel.map(d => d.dealId));
    ctx.toggleGroupSelect('D1', false);
    check('해제 반영', X.groupSel.size === 1 && !X.groupSel.has('D1'));
    ctx.clearGroupSelection();
    check('전체 해제', X.groupSel.size === 0);
  }

  console.log('\n[5] 확인 팝업 — 채널이 다르면 거부, 제품·기간 차이는 경고만');
  {
    // 채널 표기가 다른 두 건: 후보로는 잡히지만 묶기는 거부돼야 한다
    const a = setup();
    a.ctx.toggleGroupSelect('D1', true); a.ctx.toggleGroupSelect('D6', true);
    a.ctx.openGroupConfirm();
    await new Promise(r => setTimeout(r, 0));
    check('채널이 다르면 alert로 거부', a.alerts.length === 1 && a.alerts[0].indexOf('채널이 서로 달라') >= 0, a.alerts);
    check('거부 시 요청을 보내지 않음', a.sent.length === 0, a.sent);
    check('거부 사유에 채널명을 보여줌', a.alerts[0].indexOf('하늘마켓') >= 0 && a.alerts[0].indexOf('하늘 마켓') >= 0);

    // 1건만 선택
    const b = setup();
    b.ctx.toggleGroupSelect('D1', true);
    b.ctx.openGroupConfirm();
    check('1건만 선택하면 진행 불가', b.sent.length === 0 && b.toasts.join(' ').indexOf('2건 이상') >= 0, b.toasts);

    // 제품이 다른 정상 케이스 — 경고 문구를 보여주되 진행 허용
    const c = setup();
    let msg = '';
    c.ctx.confirm = m => { msg = String(m); return true; };
    c.ctx.toggleGroupSelect('D1', true); c.ctx.toggleGroupSelect('D2', true);
    c.ctx.openGroupConfirm();
    await new Promise(r => setTimeout(r, 0));
    check('제품 차이는 경고로만', msg.indexOf('제품이 서로 다릅니다') >= 0, msg);
    check('확인 내용에 채널·기간·상품코드', msg.indexOf('하늘마켓') >= 0 && msg.indexOf('2/1~2/3') >= 0 && msg.indexOf('CD1') >= 0, msg);
    check('대표 행 규칙을 안내', msg.indexOf('시작일이 가장 빠른') >= 0, msg);
    check('행이 삭제되지 않음을 안내', msg.indexOf('삭제되지 않습니다') >= 0, msg);
    check('경고를 넘기면 요청 발송', c.sent.length === 1 && c.sent[0].action === 'groupDealRows', c.sent);

    // 취소
    const e = setup();
    e.ctx.confirm = () => false;
    e.ctx.toggleGroupSelect('D1', true); e.ctx.toggleGroupSelect('D2', true);
    e.ctx.openGroupConfirm();
    await new Promise(r => setTimeout(r, 0));
    check('취소하면 요청 없음', e.sent.length === 0, e.sent);

    // 기간만 다른 경우
    const f = setup();
    let msg2 = '';
    f.ctx.confirm = m => { msg2 = String(m); return true; };
    f.ctx.toggleGroupSelect('D1', true); f.ctx.toggleGroupSelect('D3', true);
    f.ctx.openGroupConfirm();
    await new Promise(r => setTimeout(r, 0));
    check('기간 차이도 경고로만', msg2.indexOf('기간이 서로 다릅니다') >= 0, msg2);
  }

  console.log('\n[6] 묶기 요청 — 시트 행 번호를 보낸다');
  {
    const { ctx, X, sent, toasts } = setup();
    ctx.toggleGroupSelect('D1', true); ctx.toggleGroupSelect('D2', true);
    await ctx.applyGroupSelected();
    check('groupDealRows 1회', sent.length === 1 && sent[0].action === 'groupDealRows', sent.map(s => s.action));
    check('선택 건의 모든 행 번호 전달', ids(sent[0].data.rowIndexes) === '3,4', sent[0].data.rowIndexes);
    check('성공하면 선택 해제', X.groupSel.size === 0);
    check('성공 안내', toasts.join(' ').indexOf('묶었습니다') >= 0, toasts);

    // 여러 행짜리 건이 섞여도 행을 모두 보낸다(기존 그룹 흡수)
    const g = setup();
    g.ctx.toggleGroupSelect('D1', true); g.ctx.toggleGroupSelect('D2', true);
    g.X.DATA.find(d => d.dealId === 'D2').codeRows = [{ rowIndex: 4 }, { rowIndex: 11 }];
    await g.ctx.applyGroupSelected();
    check('건의 모든 codeRows 행을 전달', ids(g.sent[0].data.rowIndexes) === '11,3,4', g.sent[0].data.rowIndexes);

    // 서버 실패
    const h = setup();
    h.ctx._gasWrite = async () => { throw new Error("시트에 '공구그룹ID' 헤더가 없습니다."); };
    h.ctx.toggleGroupSelect('D1', true); h.ctx.toggleGroupSelect('D2', true);
    await h.ctx.applyGroupSelected();
    check('실패 사유를 화면에', h.toasts.join(' ').indexOf('묶기 실패') >= 0, h.toasts);
    check('실패하면 선택을 유지(재시도 가능)', h.X.groupSel.size === 2, h.X.groupSel.size);
  }

  console.log('\n[7] 묶기 해제');
  {
    const { ctx, X, sent, toasts } = setup();
    X.setModalState({ dealId: 'D7' });
    await ctx.ungroupCurrentDeal();
    check('ungroupDeal 요청', sent.length === 1 && sent[0].action === 'ungroupDeal', sent.map(s => s.action));
    check('그룹ID 전달', sent[0].data.groupId === 'G-OLD', sent[0].data);

    const b = setup();
    b.X.setModalState({ dealId: 'D1' });
    b.X.DATA.find(d => d.dealId === 'D1').groupId = '';
    await b.ctx.ungroupCurrentDeal();
    check('묶이지 않은 건은 요청 없음', b.sent.length === 0 && b.toasts.join(' ').indexOf('묶인 건이 아닙니다') >= 0, b.toasts);

    const c = setup();
    c.ctx.confirm = () => false;
    c.X.setModalState({ dealId: 'D7' });
    await c.ctx.ungroupCurrentDeal();
    check('취소하면 요청 없음', c.sent.length === 0, c.sent);
  }

  console.log('\n[8] 자동 묶기 기준은 그대로 — 느슨해지지 않았는지 고정');
  {
    const gas = fs.readFileSync(path.join(PROJ, 'apps-script.js'), 'utf8');
    const i = gas.indexOf('function _migrateDealGroupIds');
    const j = gas.indexOf('\nfunction ', i + 10);
    const body = gas.slice(i, j < 0 ? gas.length : j);
    check('마이그레이션 함수를 찾음', i >= 0);
    check('키에 시작일 포함', body.indexOf('COL.startMD') >= 0);
    check('키에 종료일 포함', body.indexOf('COL.endMD') >= 0);
    check('키에 제품 포함', body.indexOf('_normProductForGroup') >= 0);
    check('키에 채널 포함', body.indexOf('COL.channel') >= 0);
    check('느슨한 채널 비교를 쓰지 않음', body.indexOf('_normChannelLoose') < 0);
    check('느슨한 기간 비교를 쓰지 않음', body.indexOf('_periodsNear') < 0);
    // 후보 탐지(느슨)와 실제 묶기(엄격)는 서로 다른 함수여야 한다
    const gi = gas.indexOf('function _groupDealRows');
    const gj = gas.indexOf('\nfunction ', gi + 10);
    const gbody = gas.slice(gi, gj < 0 ? gas.length : gj);
    check('묶기 실행은 채널 불일치를 거부', gbody.indexOf('채널이 서로 다릅니다') >= 0);
    check('묶기 실행은 느슨한 채널 비교를 쓰지 않음', gbody.indexOf('_normChannelLoose') < 0);
  }

  console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})();
