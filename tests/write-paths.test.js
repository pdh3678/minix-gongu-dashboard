// 열 해석 전환 후에도 기존 쓰기 경로(공구건 등록/수정, 실적 입력, 팔로워 수, 등급 수동 지정)가
// 여전히 "올바른 열"에 값을 넣는지 검증. 열 번호를 코드가 아니라 헤더에서 얻게 됐으므로,
// 여기서 확인하는 건 결국 "헤더 텍스트 → 열 → 실제 기록 위치"가 끝까지 일치하는가이다.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeSheet, installGlobals } = require(path.join(__dirname, 'lib', 'mock-sheets.js'));
const GAS_PATH = process.argv[2] || path.join(__dirname, '..', 'apps-script.js');

const HEADERS = require(path.join(__dirname, 'lib', 'real-headers.js'));

const C = { brand: 1, product: 2, vendor: 3, channel: 4, platform: 5, salesTier: 6, followerTier: 7,
  marketingLink: 8, code: 9, salePrice: 10, qty: 11, revenue: 12, commission: 13, year: 14,
  startMD: 15, endMD: 16, status: 17, format: 18, composition: 19, option1: 20, option2: 21,
  firstCome: 22, targetQty: 23, extraQty: 24, note: 25, views: 26,
  link: 41, thumbs: 42, dealId: 44, codeSeq: 45,
  giftItem1: 46, firstComeQty: 52, note2: 53, tier: 54, followers: 55 };

function mkRow(o) { const r = new Array(HEADERS.length).fill(''); Object.keys(o).forEach(k => { r[k] = o[k]; }); return r; }
function freshSheet() {
  const grid = [new Array(HEADERS.length).fill(''), HEADERS.slice()];
  grid.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 플렌더', [C.channel]: '채널A', [C.platform]: '인스타',
    [C.code]: 'AAA', [C.salePrice]: 100000, [C.qty]: 300, [C.year]: 2026,
    [C.startMD]: '2026-01-10', [C.endMD]: '2026-01-15', [C.status]: '완료',
    [C.dealId]: 'D1', [C.codeSeq]: 1, [C.followers]: 250000 }));
  grid.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 플렌더', [C.channel]: '채널A',
    [C.code]: 'BBB', [C.dealId]: 'D1', [C.codeSeq]: 2 }));
  return makeSheet('실적통합', grid);
}
function loadGas(sheet) {
  installGlobals({ '실적통합': sheet });
  const ctx = vm.createContext(global);
  vm.runInContext(fs.readFileSync(GAS_PATH, 'utf8'), ctx, { filename: 'apps-script.js' });
  return ctx;
}

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

console.log('\n[A] _addDeal — 신규 공구건 등록이 올바른 열에 들어감');
{
  const sheet = freshSheet();
  const ctx = loadGas(sheet);
  const SS = ctx.SpreadsheetApp.getActiveSpreadsheet();
  const res = JSON.parse(ctx._addDeal(SS, {
    product: '더 시프트', ch: '채널B', vendor: '벤더S', platform: '유튜브',
    marketingLink: 'http://mk', codes: ['C1', 'C2'],
    s: { sale: 77000, comm: 30 }, start: '2026-05-01', end: '2026-05-07',
    status: '예정', format: '릴스', composition: '본품1',
    option2: '10:00', firstCome: '하드필터', firstComeQty: '100',
    targetQty: 500, extraQty: 100, note: 'NPAY 2만원', note2: '자유비고',
    giftItem1: '하드필터', link: 'http://ch', tier: '매크로', followers: 123456
  }));
  const g = sheet._grid;
  const row = g[res.mainRow - 1], row2 = g[res.mainRow];
  check('2개 코드 → 2행 생성', row2 && row2[C.dealId] === row[C.dealId], { a: row[C.dealId], b: row2 && row2[C.dealId] });
  check('제품명', row[C.product] === '더 시프트', row[C.product]);
  check('채널명', row[C.channel] === '채널B', row[C.channel]);
  check('플랫폼', row[C.platform] === '유튜브', row[C.platform]);
  check('마케팅 링크', row[C.marketingLink] === 'http://mk', row[C.marketingLink]);
  check('상품코드(행별로 다름)', row[C.code] === 'C1' && row2[C.code] === 'C2', [row[C.code], row2[C.code]]);
  check('공동구매가', row[C.salePrice] === 77000, row[C.salePrice]);
  check('수수료율(0.3으로 변환)', Math.abs(row[C.commission] - 0.3) < 1e-9, row[C.commission]);
  check('연도', row[C.year] === 2026, row[C.year]);
  check('진행상태', row[C.status] === '예정', row[C.status]);
  check('오픈시간', row[C.option2] === '10:00', row[C.option2]);
  check('목표수량', row[C.targetQty] === 500, row[C.targetQty]);
  check('추가물량', row[C.extraQty] === 100, row[C.extraQty]);
  check('적립금(note)', row[C.note] === 'NPAY 2만원', row[C.note]);
  check('비고(note2)', row[C.note2] === '자유비고', row[C.note2]);
  check('선착순 수량', row[C.firstComeQty] === '100', row[C.firstComeQty]);
  check('등급(수동)', row[C.tier] === '매크로', row[C.tier]);
  check('팔로워 수는 대표 행에만', row[C.followers] === 123456 && row2[C.followers] === '', [row[C.followers], row2[C.followers]]);
  check('총매출은 수식으로', /^=L\d+\*K\d+$/.test(String(row[C.revenue])), row[C.revenue]);
  check('결과값 열(G·H)은 등록 시 비어 있음', row[C.salesTier] === '' && row[C.followerTier] === '', [row[C.salesTier], row[C.followerTier]]);
}

console.log('\n[B] _updateDeal — 공통/대표행 필드가 각자 올바른 열로');
{
  const sheet = freshSheet();
  const ctx = loadGas(sheet);
  const SS = ctx.SpreadsheetApp.getActiveSpreadsheet();
  const r = JSON.parse(ctx._updateDeal(SS, {
    dealId: 'D1',
    changes: { product: '더 플렌더 mini', channel: '채널A2', vendor: '벤더X', tier: '메가',
               platform: '틱톡', note: 'NPAY 5만원', note2: '수정비고', followers: 999000,
               targetQty: 700, sale: 88000, comm: 25, qty: 400 }
  }));
  check('성공 응답', r.success === true, r);
  const p = sheet._grid[2], s = sheet._grid[3];
  check('공통 필드는 그룹 전 행에 반영(제품명)', p[C.product] === '더 플렌더 mini' && s[C.product] === '더 플렌더 mini');
  check('공통 필드(채널명)', p[C.channel] === '채널A2' && s[C.channel] === '채널A2');
  check('공통 필드(등급 수동)', p[C.tier] === '메가' && s[C.tier] === '메가', [p[C.tier], s[C.tier]]);
  check('대표행 전용(플랫폼)은 대표 행만', p[C.platform] === '틱톡' && s[C.platform] === '', [p[C.platform], s[C.platform]]);
  check('대표행 전용(적립금)', p[C.note] === 'NPAY 5만원' && p[C.note2] === '수정비고', [p[C.note], p[C.note2]]);
  check('대표행 전용(팔로워 수)', p[C.followers] === 999000 && s[C.followers] === '', [p[C.followers], s[C.followers]]);
  check('목표수량이 레거시 중복 열이 아닌 왼쪽 열에', p[C.targetQty] === 700 && p[38] === '', [p[C.targetQty], p[38]]);
  check('공동구매가/수수료율/판매수량', p[C.salePrice] === 88000 && Math.abs(p[C.commission] - 0.25) < 1e-9 && p[C.qty] === 400,
    [p[C.salePrice], p[C.commission], p[C.qty]]);
  check('총매출 수식 재기입', /^=L\d+\*K\d+$/.test(String(p[C.revenue])), p[C.revenue]);
}

console.log('\n[C] _addPerf / _updateChannelFollowers / _clearChannelTier');
{
  const sheet = freshSheet();
  const ctx = loadGas(sheet);
  const SS = ctx.SpreadsheetApp.getActiveSpreadsheet();
  sheet._grid[2][C.tier] = '메가'; sheet._grid[3][C.tier] = '메가';

  JSON.parse(ctx._addPerf(SS, { dealId: 'D1', qty: 555, views: 12 }));
  check('실적 입력 — 판매수량', sheet._grid[2][C.qty] === 555, sheet._grid[2][C.qty]);
  check('실적 입력 — 조회수', sheet._grid[2][C.views] === 12, sheet._grid[2][C.views]);
  check('실적 입력 — 총매출 수식', /^=L\d+\*K\d+$/.test(String(sheet._grid[2][C.revenue])), sheet._grid[2][C.revenue]);

  const f = JSON.parse(ctx._updateChannelFollowers(SS, { channel: '채널A', followers: '1,200,000' }));
  check('팔로워 수 갱신(콤마 문자열 허용)', sheet._grid[2][C.followers] === 1200000, [f, sheet._grid[2][C.followers]]);

  const t = JSON.parse(ctx._clearChannelTier(SS, { channel: '채널A' }));
  check('등급 수동 초기화 2행', t.cleared === 2, t);
  check('등급(수동) 열이 비워짐', sheet._grid[2][C.tier] === '' && sheet._grid[3][C.tier] === '');
  check('결과값 열(G·H)은 초기화 대상이 아님', sheet._grid[2][C.salesTier] === '', sheet._grid[2][C.salesTier]);
}

console.log('\n[D] _saveReels — 릴스 슬롯이 조회수 열 오른쪽으로 따라감');
{
  const sheet = freshSheet();
  const ctx = loadGas(sheet);
  const SS = ctx.SpreadsheetApp.getActiveSpreadsheet();
  ctx._resolveCols(sheet);
  check('REEL_COL_START(1-based) = 조회수 다음 칸', ctx.REEL_COL_START === C.views + 2, ctx.REEL_COL_START);
  JSON.parse(ctx._saveReels(SS, { dealId: 'D1', link: 'http://ch', reels: [{ url: '', views: 3 }, { url: '', views: 4 }] }));
  const p = sheet._grid[2];
  check('릴스 슬롯1/2에 조회수 기록', p[C.views + 1] === 3 && p[C.views + 2] === 4, [p[C.views + 1], p[C.views + 2]]);
  check('조회수 합계 갱신', p[C.views] === 7, p[C.views]);
  check('채널 링크 열 기록', p[C.link] === 'http://ch', p[C.link]);
}

console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
