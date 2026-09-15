const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeSheet, installGlobals } = require(path.join(__dirname, 'lib', 'mock-sheets.js'));

const GAS_PATH = process.argv[2] || path.join(__dirname, '..', 'apps-script.js');

// 운영 시트의 실제 2행 헤더(realheaders.js) — 추측이 아니라 ?debug=1 덤프에서 그대로 가져온 값
const HEADERS = require(path.join(__dirname, 'lib', 'real-headers.js'));

function buildGrid() {
  const grid = [];
  grid.push(new Array(HEADERS.length).fill('')); // 1행: 대분류 병합 헤더(내용 무관)
  grid.push(HEADERS.slice());                    // 2행: 헤더
  return grid;
}
function mkRow(o) {
  const r = new Array(HEADERS.length).fill('');
  Object.keys(o).forEach(k => { r[k] = o[k]; });
  return r;
}
function loadGas(sheets) {
  installGlobals(sheets);
  const src = fs.readFileSync(GAS_PATH, 'utf8');
  const ctx = vm.createContext(global);
  vm.runInContext(src, ctx, { filename: 'apps-script.js' });
  return ctx;
}

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

const C = { brand: 1, product: 2, vendor: 3, channel: 4, platform: 5, salesTier: 6, followerTier: 7,
  marketingLink: 8, code: 9, salePrice: 10, qty: 11, revenue: 12, commission: 13, year: 14,
  startMD: 15, endMD: 16, status: 17, format: 18, composition: 19, option1: 20, option2: 21,
  firstCome: 22, targetQty: 23, extraQty: 24, note: 25, views: 26,
  link: 41, thumbs: 42, source: 43, dealId: 44, codeSeq: 45,
  giftItem1: 46, giftQty1: 47, giftItem2: 48, giftQty2: 49, giftItem3: 50, giftQty3: 51,
  firstComeQty: 52, note2: 53, tier: 54, followers: 55 };

const grid = buildGrid();
grid.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 플렌더', [C.channel]: '채널A', [C.platform]: '인스타',
  [C.code]: 'AAA', [C.salePrice]: 100000, [C.qty]: 300, [C.revenue]: 30000000, [C.year]: 2026,
  [C.startMD]: '2026-01-10', [C.endMD]: '2026-01-15', [C.status]: '완료', [C.dealId]: 'D1', [C.codeSeq]: 1,
  [C.followers]: 250000, [C.note]: 'NPAY 2만원', [C.note2]: '자유입력 비고' }));
grid.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 플렌더', [C.channel]: '채널A',
  [C.code]: 'BBB', [C.dealId]: 'D1', [C.codeSeq]: 2 }));            // 같은 건의 2번째 코드 행
grid.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 시프트', [C.channel]: '채널B', [C.platform]: '유튜브',
  [C.code]: 'CCC', [C.salePrice]: 50000, [C.qty]: 100, [C.revenue]: 5000000, [C.year]: 2026,
  [C.startMD]: '2026-02-01', [C.endMD]: '2026-02-05', [C.status]: '완료', [C.dealId]: 'D2', [C.codeSeq]: 1 }));
grid.push(mkRow({ [C.brand]: '타사', [C.product]: '남의제품', [C.channel]: '채널Z', [C.dealId]: 'D9', [C.codeSeq]: 1 }));

const sheet = makeSheet('실적통합', grid);
const ctx = loadGas({ '실적통합': sheet });

console.log('\n[1] 헤더 기반 열 해석');
ctx._resolveCols(sheet);
const COL = ctx.COL;
let mismatched = [];
Object.keys(C).forEach(k => {
  if (COL[k] !== C[k]) mismatched.push(k + ': got ' + COL[k] + ' want ' + C[k]);
});
check('COL ' + Object.keys(C).length + '개가 전부 기대 위치로 해석됨', mismatched.length === 0, mismatched);
check('REEL_COL_START = 조회수 바로 오른쪽', ctx.REEL_COL_START === C.views + 2, ctx.REEL_COL_START);
check('레거시 중복 구성은 왼쪽 열이 선택됨', COL.composition === 19, COL.composition);
check('레거시 중복 목표수량도 왼쪽 열', COL.targetQty === 23, COL.targetQty);
check('비고가 두 열일 때 note(적립금)와 note2가 갈림', COL.note === 25 && COL.note2 === 53, { note: COL.note, note2: COL.note2 });
check('선착순이 선착순 수량을 잡지 않음', COL.firstCome === 22 && COL.firstComeQty === 52, { fc: COL.firstCome, fcq: COL.firstComeQty });
check('등급(수동)이 매출등급/팔로워등급과 안 섞임', COL.tier === 54 && COL.salesTier === 6 && COL.followerTier === 7,
  { tier: COL.tier, s: COL.salesTier, f: COL.followerTier });

console.log('\n[2] 없는 헤더 -> 명시적 에러');
try {
  ctx.getColIndexByHeader(sheet, ['존재하지않는헤더']);
  check('에러를 던져야 함', false);
} catch (e) {
  check('에러 메시지에 실제 헤더행 포함', /현재 2행 헤더/.test(e.message) && /매출등급/.test(e.message), e.message.slice(0, 140));
}
check('optional:true면 -1', ctx.getColIndexByHeader(sheet, ['없는헤더'], { optional: true }) === -1);

console.log('\n[3] parseMainSheet — 기존 필드가 밀리지 않고 tierRows가 나옴');
const parsed = ctx.parseMainSheet(sheet);
const d1 = parsed.deals.find(d => d.dealId === 'D1');
const d2 = parsed.deals.find(d => d.dealId === 'D2');
check('Minix 외 브랜드 행 제외 (2건만)', parsed.deals.length === 2, parsed.deals.map(d => d.dealId));
check('공동구매가 정상', d1.sale === 100000, d1.sale);
check('판매수량 정상', d1.qty === 300, d1.qty);
check('총매출 정상', d1.revenue === 30000000, d1.revenue);
check('시작일 정상', d1.start === '2026-01-10', d1.start);
check('상품코드 2개 수집', JSON.stringify(d1.codes) === '["AAA","BBB"]', d1.codes);
check('팔로워 수 정상', d1.followers === 250000, d1.followers);
check('적립금(note)과 비고(note2)가 안 섞임', d1.note === 'NPAY 2만원' && d1.note2 === '자유입력 비고', { note: d1.note, note2: d1.note2 });
check('tierRows가 그룹의 모든 행을 담음', JSON.stringify(d1.tierRows) === JSON.stringify([[3, '', ''], [4, '', '']]), d1.tierRows);
check('단일 행 건의 tierRows', JSON.stringify(d2.tierRows) === JSON.stringify([[5, '', '']]), d2.tierRows);

console.log('\n[4] _writeTiers — 바뀐 행만 한 번의 setValues로');
const SS = ctx.SpreadsheetApp.getActiveSpreadsheet();
sheet._calls.length = 0;
let resp = JSON.parse(ctx._writeTiers(SS, {
  rows: [
    { rowIndex: 3, salesTier: '마이크로', followerTier: '매크로' },
    { rowIndex: 4, salesTier: '마이크로', followerTier: '매크로' },
    { rowIndex: 5, salesTier: '나노', followerTier: '' }
  ]
}));
check('written = 3', resp.written === 3, resp);
const sv = sheet._calls.filter(c => c.op === 'setValues');
check('setValues 호출 1회', sv.length === 1, sv);
check('G·H 2칸 범위로 기록', sv[0].c === C.salesTier + 1 && sv[0].nc === 2, sv[0]);
check('3행 G/H', grid[2][C.salesTier] === '마이크로' && grid[2][C.followerTier] === '매크로', [grid[2][C.salesTier], grid[2][C.followerTier]]);
check('4행(보조 코드행)에도 같은 값', grid[3][C.salesTier] === '마이크로' && grid[3][C.followerTier] === '매크로');
check('5행 팔로워등급 빈값 유지', grid[4][C.salesTier] === '나노' && grid[4][C.followerTier] === '');

console.log('\n[5] 재호출 시 변화 없음 -> 쓰기 안 함');
sheet._calls.length = 0;
resp = JSON.parse(ctx._writeTiers(SS, { rows: [{ rowIndex: 3, salesTier: '마이크로', followerTier: '매크로' }] }));
check('written = 0', resp.written === 0, resp);
check('setValues 호출 0회', sheet._calls.filter(c => c.op === 'setValues').length === 0);

console.log('\n[6] 방어 — 허용값 밖 / 범위 밖 / Minix 외 행 / 헤더행');
resp = JSON.parse(ctx._writeTiers(SS, {
  rows: [
    { rowIndex: 3, salesTier: '이상한값', followerTier: '매크로' },
    { rowIndex: 6, salesTier: '메가', followerTier: '메가' },
    { rowIndex: 999, salesTier: '메가', followerTier: '메가' },
    { rowIndex: 2, salesTier: '메가', followerTier: '메가' }
  ]
}));
check('허용값 밖은 빈칸으로 기록', grid[2][C.salesTier] === '', grid[2][C.salesTier]);
check('타사(Minix 외) 행은 손대지 않음', grid[5][C.salesTier] === '', grid[5][C.salesTier]);
check('헤더행도 손대지 않음', grid[1][C.salesTier] === '매출등급', grid[1][C.salesTier]);

console.log('\n[7] 등급 결과 열 정비 — 헤더 메모 + 조건부 서식 4색');
sheet._calls.length = 0;
ctx._ensureExtraHeaders(sheet);
const notes = sheet._calls.filter(c => c.op === 'setNote');
check('G·H 헤더에 메모 2개', notes.length === 2 && notes[0].r === 2, notes.map(n => n.c));
check('메모 문구가 요구사항대로', /대시보드 자동 기록/.test(notes[0].note) && /등급\(수동\)/.test(notes[0].note), notes[0].note);
const cf = sheet._calls.filter(c => c.op === 'setConditionalFormatRules');
check('조건부 서식 4개 규칙 적용', cf.length === 1 && cf[0].n === 4, cf);

console.log('\n[8] 열이 또 밀려도 코드 수정 없이 따라감');
{
  const shifted = ['', '새로생긴열'].concat(HEADERS.slice(1));
  const g2 = [new Array(shifted.length).fill(''), shifted];
  const r = new Array(shifted.length).fill('');
  r[shifted.indexOf('브랜드')] = '미닉스';
  r[shifted.indexOf('제품명')] = '더 플렌더';
  r[shifted.indexOf('채널명')] = '채널A';
  r[shifted.indexOf('공동구매가')] = 77000;
  r[shifted.indexOf('dealId(내부용, 수동 수정 금지)')] = 'DX';
  r[shifted.indexOf('코드순번(내부용, 수동 수정 금지)')] = 1;
  g2.push(r);
  const sheet2 = makeSheet('실적통합', g2);
  const ctx2 = loadGas({ '실적통합': sheet2 });
  ctx2._resolveCols(sheet2);
  check('brand가 한 칸 밀려 해석됨', ctx2.COL.brand === shifted.indexOf('브랜드'), ctx2.COL.brand);
  const p2 = ctx2.parseMainSheet(sheet2);
  check('밀린 시트에서도 공동구매가 정상', p2.deals[0].sale === 77000, p2.deals[0].sale);
  check('밀린 시트에서도 매출등급 열 인식', ctx2.COL.salesTier === shifted.indexOf('매출등급'), ctx2.COL.salesTier);
}


console.log('\n[9] 중복 헤더 "왼쪽 우선" 규칙 (합성)');
{
  /* 운영 시트의 레거시 중복 헤더(AN 목표수량 / AO 구성)는 2026-09-15에 채널 속성 열로 교체돼
     실데이터에서는 사라졌다. 하지만 규칙 자체는 여전히 '비고'(적립금 자리 / 신규 비고) 두 열을
     가르는 근거이고, 앞으로 또 중복이 생길 수 있으므로 합성 시트로 계속 지킨다. */
  const dup = HEADERS.slice();
  dup.push('목표수량', '구성');           // 오른쪽에 중복 헤더를 일부러 심는다
  const g2 = [new Array(dup.length).fill(''), dup];
  const r = new Array(dup.length).fill('');
  r[1] = '미닉스'; r[2] = '더 플렌더'; r[4] = '채널A';
  g2.push(r);
  const sheet2 = makeSheet('실적통합', g2);
  const ctx2 = loadGas({ '실적통합': sheet2 });
  ctx2._resolveCols(sheet2);
  check('목표수량은 왼쪽(X=23) 선택', ctx2.COL.targetQty === 23, ctx2.COL.targetQty);
  check('구성은 왼쪽(T=19) 선택', ctx2.COL.composition === 19, ctx2.COL.composition);
  check('오른쪽 중복은 아무 논리열도 차지하지 않음',
    Object.keys(ctx2.COL).every(k => ctx2.COL[k] !== dup.length - 1 && ctx2.COL[k] !== dup.length - 2));
  check("'비고' 두 열은 여전히 갈림 (적립금 자리 / 신규 비고)",
    ctx2.COL.note === 25 && ctx2.COL.note2 === 53, { note: ctx2.COL.note, note2: ctx2.COL.note2 });
}
console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
