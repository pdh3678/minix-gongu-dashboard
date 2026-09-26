/* samples/ 실파일 파싱 요약 — 로컬 확인용(테스트 아님, 결과를 커밋하지 않는다).
   실행: XLSX_PATH=<SheetJS 모듈 경로> node scripts/summarize-offline-samples.js [폴더(기본 samples)]
   SheetJS는 저장소 의존성이 아니다 — npm i --no-save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
   처럼 저장소 밖(또는 --no-save)으로 받아 경로를 넘긴다.
   출력은 집계값(유형·헤더 행·기준일·행수·코드 종류 수)뿐이다 — 실데이터 값은 찍지 않는다. */
const fs = require('fs'), path = require('path');
const P = require(path.join(__dirname, '..', 'src', 'features', 'offline', 'parsers.js'));

let XLSX;
try { XLSX = require(process.env.XLSX_PATH || 'xlsx'); }
catch (e) { console.error('SheetJS가 없습니다. XLSX_PATH=<xlsx 모듈 경로> 로 실행하세요.'); process.exit(2); }

const dir = process.argv[2] || path.join(__dirname, '..', 'samples');
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // Asia/Seoul
const files = fs.readdirSync(dir).filter(f => /\.(xlsx|xls|csv)$/i.test(f)).sort();
const out = [];
for (const f of files) {
  const { rows } = P.readWorkbookRows(XLSX, fs.readFileSync(path.join(dir, f)));
  const r = P.parseRows(rows, { fileName: f, today });
  if (!r.ok) { out.push({ 파일: f, 유형: '판별 실패', 비고: r.error }); continue; }
  out.push({
    파일: f, 유형: r.type, 헤더행: r.headerRow,
    '기준일/기간': r.kind === 'period' ? (r.period ? r.period.start + '~' + r.period.end : '-') : (r.baseDate || '(선택 필요)'),
    원본행수: r.rawRowCount, 코드종류: r.codes.length, 점포수: r.records.stores.length,
    반영예정: Object.keys(r.plannedRows).map(k => k + ' ' + r.plannedRows[k]).join(', '),
    경고: r.warnings.join(' / ') || '-'
  });
}
console.table(out);
