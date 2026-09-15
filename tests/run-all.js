/* 전체 테스트 실행 — node tests/run-all.js
   각 스위트를 별도 프로세스로 돌린다(전역/모듈 캐시가 서로 섞이지 않게).
   하나라도 실패하면 exit 1. */
const { execFileSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['columns.test.js',    '열 해석 — 2행 헤더로 COL을 찾고, 중복/유사 헤더를 올바르게 가름'],
  ['write-paths.test.js','쓰기 경로 — 등록/수정/실적/팔로워/등급이 올바른 열에 들어감'],
  ['frontend.test.js',   '프론트 — 응답 변환·등급 산정·시트 기록 payload'],
  ['save-path.test.js',  '저장 통합 — 프론트+GAS 실코드로 낙관적 저장 왕복'],
  ['embed.test.js',      '임베드 모드 — 셸 숨김, 쿼리 보존, 프레임 허용 헤더'],
  ['channel-fields.test.js','채널 필드 전파(GAS) — fillEmpty/overwrite, 열 없을 때 안전'],
  ['channel-front.test.js', '채널 필드(프론트) — 불일치 판정, 확인 팝업, 로컬 전파']
];

let failed = 0;
const results = [];
for (const [file, desc] of SUITES) {
  process.stdout.write('\n═══ ' + file + ' — ' + desc + '\n');
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
    const m = out.match(/통과 (\d+) \/ 실패 (\d+)/);
    results.push([file, m ? Number(m[1]) : 0, m ? Number(m[2]) : 0, true]);
    process.stdout.write(out.split('\n').filter(l => /PASS|FAIL|통과/.test(l)).slice(-1)[0] + '\n');
  } catch (e) {
    failed++;
    const out = (e.stdout || '') + (e.stderr || '');
    process.stdout.write(out);
    const m = out.match(/통과 (\d+) \/ 실패 (\d+)/);
    results.push([file, m ? Number(m[1]) : 0, m ? Number(m[2]) : 1, false]);
  }
}

let tp = 0, tf = 0;
console.log('\n' + '═'.repeat(62));
results.forEach(([file, p, f, ok]) => {
  tp += p; tf += f;
  console.log((ok ? '  OK  ' : ' FAIL ') + file.padEnd(24) + ('통과 ' + p).padStart(8) + ('실패 ' + f).padStart(8));
});
console.log('═'.repeat(62));
console.log('  합계  ' + ('통과 ' + tp).padStart(30) + ('실패 ' + tf).padStart(8));
if (failed) console.log('\n실패한 스위트가 있습니다.');
process.exit(failed ? 1 : 0);
