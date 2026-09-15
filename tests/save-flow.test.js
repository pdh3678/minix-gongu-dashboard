/* 저장 함수를 **끝까지 실제로 실행**해서 경로가 끊기지 않는지 본다.

   왜 필요한가: 지금까지의 저장 테스트는 _gasWrite를 직접 불러 payload만 확인했기 때문에,
   saveSchemeModal 안에서 생기는 문제(선언 누락, 스코프 오류, 정의되지 않은 참조)는 전혀 잡지
   못했다. 실제로 try 블록을 씌우면서 `const tiers`가 블록에 갇혀 "tiers is not defined"로
   저장이 통째로 깨졌는데도 테스트는 전부 통과했다. 그래서 여기서는 함수를 통으로 돌린다.

   DOM은 값 맵으로 흉내 내고, 네트워크(_gasWrite)만 가로챈다. ReferenceError·TypeError가 나면
   그대로 실패로 드러난다.

   실행: node tests/save-flow.test.js  (또는 node tests/run-all.js) */
const path = require('path');
const { loadFrontend } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(l, c, extra) {
  if (c) { pass++; console.log('  PASS  ' + l); }
  else { fail++; console.log('  FAIL  ' + l + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

/* 모달 입력칸을 값 맵으로 흉내 낸다. 없는 id는 빈 값 요소를 만들어 돌려주므로,
   코드가 새 필드를 참조하기 시작해도 테스트가 먼저 깨지지 않는다(그건 DOM 무결성 검사의 몫). */
function makeDom(values) {
  const els = {};
  const mk = id => ({
    id, value: values[id] != null ? values[id] : '', style: {}, textContent: '', innerHTML: '',
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, contains(c){return this._s.has(c);} },
    closest: () => ({ querySelector: () => null, appendChild(){} }),
    parentElement: { querySelector: () => null, appendChild(){} },
    querySelectorAll: () => [], querySelector: () => null, appendChild(){}, focus(){}, remove(){}
  });
  return { els, getElementById: id => (els[id] = els[id] || mk(id)) };
}

// 저장에 필요한 최소 입력값 — 품목군/제품은 시트 표기 매핑이 있는 조합으로
const BASE_FIELDS = {
  mLine: '더시프트', mModel: '더시프트', mInfluencer: '채널A', mPlatform: '인스타그램',
  mMonth: '4', mStart: '2026-04-06', mEnd: '2026-04-08',
  mSaleInput: '10000', mCommInput: '10', mQtyInput: '100', mTargetQty: '200',
  mVendor: '', mLinkInput: '', mMarketingLink: '', mFormat: '', mComposition: '',
  mOpenTime: '', mFirstComeItem: '', mFirstComeQty: '', mPoints: '', mNoteInput: '',
  mExtraQty: '', mTier: '', mFollowers: '', mIgId: '', mYtId: '', mYear: '2026'
};

function setup(dealOverrides, fieldOverrides) {
  const { ctx, X } = loadFrontend(PROJ);
  const dom = makeDom(Object.assign({}, BASE_FIELDS, fieldOverrides || {}));
  ctx.document.getElementById = dom.getElementById;
  ctx.document.querySelectorAll = () => [];
  ctx.document.createElement = () => ({ className: '', textContent: '', appendChild(){} });

  const deal = Object.assign({
    id: 3, dealId: 'D1', groupId: 'D1', brand: 'Minix', product: '더 시프트', ch: '채널A',
    influencer: '채널A', platform: '인스타그램', start: '2026-04-06', end: '2026-04-08',
    status: '완료', qty: 100, rev: 1000000, codes: ['C1'], reels: [], rowCount: 1,
    _tierRows: [[3, '', '']], codeRows: [{ rowIndex: 3, code: 'C1', qty: 100, revenue: 1000000, status: '완료', views: null }],
    s: { sale: 10000, comm: 10, note: '' }
  }, dealOverrides || {});

  const DATA = X.DATA;
  DATA.splice(0, DATA.length, deal);
  ctx.invalidateTierStats(); ctx.invalidateChannelInfo();
  X.setModalState({ dealId: deal.dealId, channel: deal.ch });

  // 화면/네트워크는 흉내만
  const sent = [];
  ctx._getGasUrl = () => 'https://example.test/exec';
  ctx._gasWrite = async (url, action, data) => { sent.push({ action, data }); return { success: true, rowIndex: 3, rowCount: deal.rowCount, tierRows: deal._tierRows }; };
  ctx.showToast = () => {}; ctx.closeSchModal = () => {}; ctx.render = () => {};
  ctx.setLoad = () => {}; ctx._refreshModalHeader = () => {};
  ctx._openRegisteredModal = () => {}; ctx.confirm = () => true; ctx.alert = () => {};
  // 모달 편집 버퍼는 _renderCodeRowsPanel이 채우는 값이라 여기서 직접 세팅
  X.setModalState({
    codeRows: (deal.codeRows || []).map(r => Object.assign({}, r)),
    codes: (deal.codes || []).slice(), gifts: [], reels: [], hadReels: false
  });
  return { ctx, X, deal, sent, dom };
}

(async () => {
  console.log('\n[1] 단일 행 건 — saveSchemeModal을 끝까지 실행');
  {
    const { ctx, sent, dom } = setup({}, { mQtyInput: '150' });
    let threw = null;
    try { await ctx.saveSchemeModal(); } catch (e) { threw = e; }
    await new Promise(r => setTimeout(r, 0));
    check('예외 없이 완료', threw === null, threw && threw.message);
    check('요청이 나감', sent.length === 1 && sent[0].action === 'updateDeal', sent.map(s => s.action));
    check('payload에 tiers 포함(스코프 회귀 방지)', sent.length && sent[0].data.tiers !== undefined, sent[0] && Object.keys(sent[0].data));
    check('검증 오류 요약이 비어 있음', !dom.els.mSaveErr || dom.els.mSaveErr.style.display === 'none' || !dom.els.mSaveErr.textContent,
      dom.els.mSaveErr && dom.els.mSaveErr.textContent);
  }

  console.log('\n[2] 그룹 건 — 상품코드별 실적이 payload에 실린다');
  {
    const { ctx, sent } = setup({
      rowCount: 3, groupId: 'G-LZ', ch: '러브지나', influencer: '러브지나',
      codes: ['LZ-A', 'LZ-B', 'LZ-C'],
      _tierRows: [[3, '', ''], [4, '', ''], [5, '', '']],
      codeRows: [
        { rowIndex: 3, code: 'LZ-A', qty: 100, revenue: 1000000, status: '완료', views: null },
        { rowIndex: 4, code: 'LZ-B', qty: 50, revenue: 500000, status: '완료', views: null },
        { rowIndex: 5, code: 'LZ-C', qty: 20, revenue: 200000, status: '완료', views: null }
      ]
    }, { mInfluencer: '러브지나' });
    let threw = null;
    try { await ctx.saveSchemeModal(); } catch (e) { threw = e; }
    await new Promise(r => setTimeout(r, 0));
    check('예외 없이 완료', threw === null, threw && threw.message);
    check('요청 1회', sent.length === 1, sent.length);
    check('groupId 전달', sent[0].data.groupId === 'G-LZ', sent[0].data.groupId);
    check('codeRows 3행 전달', (sent[0].data.codeRows || []).length === 3, sent[0].data.codeRows);
    check('tiers 전달', !!sent[0].data.tiers, sent[0].data.tiers);
  }

  console.log('\n[3] 검증 실패 — 저장 요청을 보내지 않고 화면에 이유를 남긴다');
  {
    const { ctx, sent, dom } = setup({}, { mMonth: '' });
    let threw = null;
    try { await ctx.saveSchemeModal(); } catch (e) { threw = e; }
    check('예외 없이 반환', threw === null, threw && threw.message);
    check('요청을 보내지 않음', sent.length === 0, sent.length);
    check('월 필드에 오류 표시', dom.els.mMonth.classList.contains('f-err'));
    check('요약에 이유 노출', (dom.els.mSaveErr.textContent || '').indexOf('월을 선택') >= 0, dom.els.mSaveErr.textContent);
  }

  console.log('\n[4] 서버 실패 — 롤백하고 이유를 남긴다');
  {
    const { ctx, deal, dom } = setup({}, { mQtyInput: '777' });
    ctx._gasWrite = async () => { throw new Error('시트 헤더를 찾을 수 없습니다'); };
    let reopened = null;
    ctx._openRegisteredModal = d => { reopened = d; };
    let threw = null;
    try { await ctx.saveSchemeModal(); } catch (e) { threw = e; }
    await new Promise(r => setTimeout(r, 20));
    check('예외가 밖으로 새지 않음', threw === null, threw && threw.message);
    check('롤백됨(판매수량 원복)', deal.qty === 100, deal.qty);
    check('잠금 해제', ctx.isDealSaving('D1') === false);
    check('모달 재오픈', reopened !== null);
    check('실패 사유를 화면에 남김', (dom.els.mSaveErr.textContent || '').indexOf('시트 헤더를 찾을 수 없습니다') >= 0,
      dom.els.mSaveErr.textContent);
  }

  console.log('\n[5] 신규 등록 — saveDeal을 끝까지 실행');
  {
    const { ctx, X } = setup();
    const vals = {
      fLine: '더시프트', fModel: '더시프트', fInfluencer: '새채널', fPlatform: '인스타그램',
      fIgId: 'new.ch', fYtId: '', fMonth: '9', fStart: '2026-09-15', fEnd: '2026-09-20',
      fSalePrice: '10000', fCommission: '10', fVendor: '', fLink: '', fMarketingLink: '',
      fFormat: '', fComposition: '', fTargetQty: '', fExtraQty: '', fOpenTime: '',
      fFirstComeItem: '', fFirstComeQty: '', fPoints: '', fNote: '', fTier: '', fFollowers: '', fYear: '2026'
    };
    const dom2 = makeDom(vals);
    ctx.document.getElementById = dom2.getElementById;
    X.setFormState({ codes: ['N1'], gifts: [] });
    const sent2 = [];
    ctx._gasWrite = async (url, action, data) => { sent2.push({ action, data }); return { success: true, dealId: 'NEW', mainRow: 9, rowIndex: 9, rowCount: 1, tierRows: [[9, '', '']] }; };
    ctx.closeDealForm = () => {}; ctx.render = () => {}; ctx.showToast = () => {};
    let threw = null;
    try { await ctx.saveDeal(); } catch (e) { threw = e; }
    await new Promise(r => setTimeout(r, 20));
    check('예외 없이 완료', threw === null, threw && threw.message);
    check('addSalesRow 요청', sent2.length === 1 && sent2[0].action === 'addSalesRow', sent2.map(s => s.action));
    check('tiers 포함', sent2.length && sent2[0].data.tiers !== undefined, sent2[0] && Object.keys(sent2[0].data));
    check('플랫폼 ID 포함', sent2.length && sent2[0].data.igId === 'new.ch', sent2[0] && sent2[0].data.igId);
  }

  console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})();
