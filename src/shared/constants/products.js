'use strict';
/* 품목 분류 상수 — 시트 제품명 표기, 세부 모델·품목군 정의. */

// 시트 C열(제품명) 데이터 확인 규칙이 실제로 허용하는 표기 — 폼/모달 내부에서 쓰는 공백 없는 값을
// 저장 직전에 반드시 이 표기로 바꿔야 함(공백 차이로 "데이터 확인 규칙을 위반합니다" 저장 실패가
// 반복 발생했던 이력 — 더시프트/더시프트PRO도 2026-07-28에 같은 이유로 재발했다가 아래 표기로
// 수정함). 2026-07-28 기준 사용자가 직접 확인한 시트 규칙 목록: 더 슬림, 더 플렌더 MAX, 더 플렌더
// PRO, 더글로우, 더 시프트, 미니건조기, 프로그램 G필, 프로티원, 더 플렌더 NEXT, 더 시프트 PRO.
// ★ 이 목록엔 "더 플렌더 MINI"와 "더 에어드라이"가 안 보임 — 이전 확인 때는 있었던 값이라, 실수로
//   빠졌는지 실제로 규칙에서 제거됐는지 반드시 시트에서 재확인 필요. 확인 전까지는 기존 표기를
//   그대로 유지해뒀으니, 이 두 제품으로 저장이 또 실패하면 이 주석부터 다시 볼 것.
// 2026-07-29 확정(실제 시트 검증 에러 메시지에서 직접 확보한 허용 목록 — 더 이상 추측 아님):
// 더 슬림, 더 플렌더 MAX, 더 플렌더 PRO, 더글로우, 더 시프트, 미니건조기, 프로그램 G필, 프로티원,
// 더 플렌더 NEXT, 더 시프트 PRO, 더 플렌더 mini(소문자!), 더 에어드라이 — 전부 띄어쓰기 포함.
// ⚠ 이전엔 mini를 대문자(MINI)로 잘못 매핑해서 "더플렌더mini" 저장이 전부 실패하고 있었음(헤이지니
// 건 등) — 시트 규칙은 소문자 mini가 정답. 더글로우/프로그램 G필/프로티원/미니건조기는 톰 브랜드
// 제품이라 이 대시보드(Minix 전용) 드롭다운엔 없음 — 매핑 테이블에 없어도 정상.
const PRODUCT_SHEET_NAME={
  '더플렌더PRO':'더 플렌더 PRO',
  '더플렌더MAX':'더 플렌더 MAX',
  '더플렌더mini':'더 플렌더 mini',
  '더플렌더NEXT':'더 플렌더 NEXT',
  '더시프트':'더 시프트',
  '더시프트PRO':'더 시프트 PRO',
  '더에어드라이':'더 에어드라이',
  '더슬림':'더 슬림'
};
// 매핑에 없는 내부 표기로 저장을 시도하면(드롭다운에 새 옵션만 추가하고 매핑 갱신을 깜빡한 경우 등)
// null을 반환해서 호출부가 저장 자체를 막고 사용자에게 알리게 함 — 예전처럼 콘솔 경고만 남기고
// 원본 값을 그대로 내보내면, 시트 규칙 위반이 저장 시점에야(그것도 CORS로 위장된 채) 발견됨.
function toSheetProductName(p){
  if(!p)return p;
  const mapped=PRODUCT_SHEET_NAME[p];
  if(mapped===undefined){
    console.error('[제품명 매핑] "'+p+'"에 대한 시트 표기 매핑이 없습니다 — 저장을 차단합니다. PRODUCT_SHEET_NAME에 추가하세요.');
    return null;
  }
  return mapped;
}

// 제품별 뱃지/캘린더 막대 색상 — 색상 정의는 이 맵 한 곳에서만 관리 (변경 시 전체에 반영됨)
// ── 제품 분류 규칙(한 곳에서 관리, 2026-08-21) ──────────────────────────────────
// 세부 모델(fine-grained) → 대분류 제품 라인(line) + 표시 라벨 + 배지 색을 이 배열 하나로 정의.
// 새 모델이 나오면 이 배열에 한 줄만 추가하면 채널별 성과 필터/시즌성 제품군 필터/제품군별 비교/
// 배지 색 등 대시보드 전체에 자동 반영됨(PRODUCT_COLORS/PRODUCT_GROUP_LABELS/PRODUCT_LINE_OF는
// 전부 이 배열에서 파생 — 따로따로 손댈 필요 없음). line 값은 등록 폼의 LINE_HAS_MODELS/
// LINE_MODEL_OPTIONS와 동일한 "제품 라인" 개념을 그대로 씀.
// 더 플렌더 NEXT/더 시프트 PRO는 아직 출시 전이라 실제 데이터는 없지만, 미리 등록해두면 출시 후
// 데이터가 들어오는 순간 별도 코드 수정 없이 모든 필터/집계에 자동으로 나타남.
const PRODUCT_TAXONOMY=[
  {key:'플렌더PRO',  line:'더플렌더',    label:'더 플렌더 PRO',  color:{bg:'#F3E8FF',fg:'#7C3AED'}},
  {key:'플렌더MAX',  line:'더플렌더',    label:'더 플렌더 MAX',  color:{bg:'#DBEAFE',fg:'#2563EB'}},
  {key:'플렌더mini', line:'더플렌더',    label:'더 플렌더 mini', color:{bg:'#DCFCE7',fg:'#16A34A'}},
  {key:'플렌더NEXT', line:'더플렌더',    label:'더 플렌더 NEXT', color:{bg:'#FEF9C3',fg:'#CA8A04'}}, // 출시 예정
  {key:'시프트',     line:'더시프트',    label:'더 시프트',      color:{bg:'#FFEDD5',fg:'#EA580C'}},
  {key:'시프트PRO',  line:'더시프트',    label:'더 시프트 PRO',  color:{bg:'#FFE1B8',fg:'#C2410C'}}, // 출시 예정
  {key:'슬림',       line:'더슬림',      label:'더 슬림',        color:{bg:'#CCFBF1',fg:'#0D9488'}},
  {key:'에어드라이', line:'더에어드라이', label:'더 에어드라이', color:{bg:'#FFE4E6',fg:'#E11D48'}},
];
const PRODUCT_COLORS=Object.assign({},...PRODUCT_TAXONOMY.map(t=>({[t.key]:t.color})),{other:{bg:'#F3F4F6',fg:'#6B7280'}});
const PRODUCT_GROUP_LABELS=Object.assign({},...PRODUCT_TAXONOMY.map(t=>({[t.key]:t.label})),{other:'기타'});
// 세부 모델 → 제품 라인(대분류) 매핑도 PRODUCT_TAXONOMY 하나에서 파생 — 새 모델 한 줄 추가만으로
// 시즌성 제품군 필터 등 라인 단위 집계에 자동 반영됨
const PRODUCT_LINE_OF=Object.assign({},...PRODUCT_TAXONOMY.map(t=>({[t.key]:t.line})));
/* ── 제품 라인(대분류) 정의 — 품목군이 통째로 새로 생길 때 손대는 유일한 곳 ──────────────
   (기존 라인에 세부 모델만 추가되는 경우는 위 PRODUCT_TAXONOMY만 고치면 됨)
   배열 순서 = 사이드바 '품목별 실적' 순서 = 대시보드 품목 필터/히트맵 열 순서.
     key   PRODUCT_TAXONOMY의 line 값(공백 없는 내부 표기). 모달 품목군 드롭다운의 value.
     st    품목별 실적 페이지의 ST.prod 값(= 사이드바 data-prod, filteredProd의 분기 키)
     slug  해시 라우팅용 ASCII 슬러그(#product-<slug>) — 한글 슬러그는 퍼센트 인코딩돼 읽을 수 없어짐
     icon  사이드바 아이콘
   사이드바 메뉴·해시 라우팅(ST_PRODUCT_TO_HASH/HASH_PRODUCT_TO_ST)·등록/수정 모달의 품목군
   드롭다운이 전부 이 배열 하나에서 생성됨 — HTML에 품목을 직접 써넣지 말 것.
   세부 모델이 있는 라인은 LINE_HAS_MODELS/LINE_MODEL_OPTIONS/PRODUCT_MODEL_TABS에도 등록해야
   하고, 없는 라인(더 슬림·더 에어드라이)은 그 셋 모두에서 빠져 단일 제품으로 동작함. */
const PRODUCT_LINES=[
  {key:'더플렌더',    st:'플렌더',    slug:'TheFlender', label:'더 플렌더',    icon:'🌀'},
  {key:'더시프트',    st:'시프트',    slug:'TheShift',   label:'더 시프트',    icon:'📦'},
  {key:'더슬림',      st:'슬림',      slug:'TheSlim',    label:'더 슬림',      icon:'🧹'},
  {key:'더에어드라이', st:'에어드라이', slug:'TheAirDry',  label:'더 에어드라이', icon:'💨'},
];
const PRODUCT_LINE_LABELS=Object.assign({},...PRODUCT_LINES.map(l=>({[l.key]:l.label})),{other:'기타'});
