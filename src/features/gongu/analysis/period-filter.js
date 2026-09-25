'use strict';
/* 공구 분석 — 연/월/주차 기간 필터와 드롭다운 포탈. */

/* ── 대시보드 페이지: 기간 필터 ── */
const _pad2=n=>String(n).padStart(2,'0');
function _mondayOf(dateStr){
  const sd=new Date(dateStr+'T00:00:00');
  const dow=(sd.getDay()+6)%7;
  const mon=new Date(sd.getFullYear(),sd.getMonth(),sd.getDate()-dow);
  return`${mon.getFullYear()}-${_pad2(mon.getMonth()+1)}-${_pad2(mon.getDate())}`;
}
/* 연도→월→주차 계층 다중선택. null=전체, Set=명시적 선택 — 단, 빈 Set(전부 해제)도 "전체"와
   동일하게 취급함(아래 _dashActive 참고). 체크박스 렌더링만 null과 빈 Set을 구분해서 보여줌. */
function dashPAvailableYears(){
  return[...new Set(DATA.filter(d=>d.start).map(d=>yearOf(d.start)))].sort((a,b)=>a-b);
}
// null 또는 빈 Set(전부 해제)은 둘 다 "이 단계는 필터하지 않음"(상위 단계 전체)으로 취급.
// 빈 Set을 null과 구분해서 보관하는 이유는 체크박스 렌더링(전부 해제 시 전부 미체크로 보여야 함)
// 때문일 뿐 — 매칭/집계/요약 표시에서는 항상 이 헬퍼로 판단해 동일하게 취급함.
function _dashActive(s){return s!==null&&s.size>0;}
function dashPAvailableMonths(){
  const scope=DATA.filter(d=>d.start&&(!_dashActive(DASH.years)||DASH.years.has(yearOf(d.start))));
  return[...new Set(scope.map(d=>monthOf(d.start)))].sort((a,b)=>a-b);
}
function dashPAvailableWeeks(){
  const scope=DATA.filter(d=>d.start&&(!_dashActive(DASH.years)||DASH.years.has(yearOf(d.start)))&&(!_dashActive(DASH.months)||DASH.months.has(monthOf(d.start))));
  return[...new Set(scope.map(d=>_mondayOf(d.start)))].sort();
}
function dashPWeekLabel(monday){
  const e=new Date(monday+'T00:00:00');e.setDate(e.getDate()+6);
  return`${fmtS(monday)}~${fmtS(`${e.getFullYear()}-${_pad2(e.getMonth()+1)}-${_pad2(e.getDate())}`)}`;
}
function _dashCompressRange(nums){
  if(nums.length===1)return String(nums[0]);
  const ranges=[];let start=nums[0],prev=nums[0];
  for(let i=1;i<nums.length;i++){
    if(nums[i]===prev+1){prev=nums[i];continue;}
    ranges.push(start===prev?String(start):`${start}~${prev}`);
    start=prev=nums[i];
  }
  ranges.push(start===prev?String(start):`${start}~${prev}`);
  return ranges.join('·');
}
function dashPLabel(kind){
  const val=DASH[kind];
  const name=kind==='years'?'연도':kind==='months'?'월':'주차';
  if(!_dashActive(val))return`${name}: 전체`;
  const arr=kind==='weeks'?[...val].sort():[...val].sort((a,b)=>a-b);
  if(kind==='weeks')return arr.length===1?`주차: ${dashPWeekLabel(arr[0])}`:`주차: ${dashPWeekLabel(arr[0])} 외 ${arr.length-1}개`;
  return`${name}: ${arr.length===1?arr[0]+(kind==='years'?'년':'월'):_dashCompressRange(arr)+(kind==='years'?'년':'월')}`;
}
function dashPSummary(){
  const parts=[];
  if(_dashActive(DASH.years))parts.push([...DASH.years].sort((a,b)=>a-b).join('·')+'년');
  if(_dashActive(DASH.months))parts.push(_dashCompressRange([...DASH.months].sort((a,b)=>a-b))+'월');
  if(_dashActive(DASH.weeks))parts.push([...DASH.weeks].length+'개 주차');
  const periodText=parts.length?parts.join(' · '):'전체 기간';
  const prod=_dashProductLabel();
  return prod?`${periodText} · ${prod}`:periodText; // 예: "2026년 · 더 플렌더 MAX"
}
function dashPNormalizeChildren(changedKind){
  if(changedKind==='years'&&DASH.months instanceof Set){
    const validM=new Set(dashPAvailableMonths());
    DASH.months=new Set([...DASH.months].filter(m=>validM.has(m)));
  }
  if((changedKind==='years'||changedKind==='months')&&DASH.weeks instanceof Set){
    const validW=new Set(dashPAvailableWeeks());
    DASH.weeks=new Set([...DASH.weeks].filter(w=>validW.has(w)));
  }
}
function _dashAvailableFor(kind){
  if(kind==='years')return dashPAvailableYears();
  if(kind==='months')return dashPAvailableMonths();
  return dashPAvailableWeeks();
}
function dashPToggle(kind,val,checked){
  if(DASH[kind]===null)DASH[kind]=new Set(_dashAvailableFor(kind));
  if(checked)DASH[kind].add(val);else DASH[kind].delete(val);
  dashPNormalizeChildren(kind);
  dashPSave();renderDashboard();
}
function dashPAll(kind){DASH[kind]=null;dashPNormalizeChildren(kind);dashPSave();renderDashboard();}
function dashPNone(kind){DASH[kind]=new Set();dashPNormalizeChildren(kind);dashPSave();renderDashboard();}
function renderDashPeriodBar(){
  _renderDashInfluencerChip();
  const tierSel=document.getElementById('dashTierFilter');
  if(tierSel)tierSel.value=DASH.revTier||'all';
  const fTierSel=document.getElementById('dashFollowerTierFilter');
  if(fTierSel)fTierSel.value=DASH.followerTier||'all';
  _renderDashProductOptions();
  const years=dashPAvailableYears(),months=dashPAvailableMonths(),weeks=dashPAvailableWeeks();
  document.getElementById('dashPYearBtn').textContent=dashPLabel('years');
  document.getElementById('dashPYearPop').innerHTML=`
    <div class="ym-mini-row"><button class="ym-mini-btn" onclick="dashPAll('years')">전체 선택</button><button class="ym-mini-btn" onclick="dashPNone('years')">전체 해제</button></div>
    <div class="ym-chk-list">${years.map(y=>`<label class="ym-chk"><input type="checkbox" ${(DASH.years===null||DASH.years.has(y))?'checked':''} onchange="dashPToggle('years',${y},this.checked)">${y}년</label>`).join('')||'<span style="font-size:11px;color:var(--text-3)">데이터 없음</span>'}</div>`;
  document.getElementById('dashPMonthBtn').textContent=dashPLabel('months');
  document.getElementById('dashPMonthPop').innerHTML=`
    <div class="ym-mini-row"><button class="ym-mini-btn" onclick="dashPAll('months')">전체 선택</button><button class="ym-mini-btn" onclick="dashPNone('months')">전체 해제</button></div>
    <div class="ym-chk-list">${months.map(m=>`<label class="ym-chk"><input type="checkbox" ${(DASH.months===null||DASH.months.has(m))?'checked':''} onchange="dashPToggle('months',${m},this.checked)">${m}월</label>`).join('')||'<span style="font-size:11px;color:var(--text-3)">데이터 없음</span>'}</div>`;
  document.getElementById('dashPWeekBtn').textContent=dashPLabel('weeks');
  document.getElementById('dashPWeekPop').innerHTML=`
    <div class="ym-mini-row"><button class="ym-mini-btn" onclick="dashPAll('weeks')">전체 선택</button><button class="ym-mini-btn" onclick="dashPNone('weeks')">전체 해제</button></div>
    <div class="ym-chk-list">${weeks.map(w=>`<label class="ym-chk"><input type="checkbox" ${(DASH.weeks===null||DASH.weeks.has(w))?'checked':''} onchange="dashPToggle('weeks','${w}',this.checked)">${dashPWeekLabel(w)}</label>`).join('')||'<span style="font-size:11px;color:var(--text-3)">데이터 없음</span>'}</div>`;
  document.getElementById('dashPeriodSummary').textContent=dashPSummary();
  // 방금 다시 그린 팝오버가 열려 있는 상태였다면(체크박스/버튼 클릭 직후) 위치를 다시 계산
  const openDd=document.querySelector('.ym-dd.open');
  if(openDd)_positionYmDdPop(openDd);
}
// dashPeriodMatch 이름은 그대로 두지만(호출부가 많아 바꾸면 diff가 커짐) 이제 기간뿐 아니라
// 인플루언서(DASH.channel) 조건도 함께 봄 — dashData()/_dashRevScope()를 거치는 대시보드 전 섹션
// (KPI/차트/채널별 성과/개별 공구건 목록/달성률 등)에 이 한 곳만 고쳐서 전역으로 반영됨.
// opts로 특정 조건만 건너뛸 수 있음(기본값 없음 = 전부 적용). 등급별 성과 섹션처럼 "이 필터는
// 일부러 무시해야 의미가 있는" 차트들이 스코프 규칙을 각자 새로 짜지 않고 여기 한 곳을 재사용하게 함:
//   ignoreTier      — 등급 비교 차트(한 등급만 남기면 비교 대상이 사라짐 → 대신 강조로 표현)
//   ignorePeriod    — 재협업률(기간을 자르면 재협업이 원리상 안 보임)
//   ignoreMonthWeek — 월별 믹스/시즌성(월을 자르면 월별 추이 자체가 없어짐)
//   ignoreProduct   — 등급×제품군 히트맵(열을 지우면 제품군 비교가 사라짐 → 강조로 표현)
function dashPeriodMatch(d,opts){
  const o=opts||{};
  if(!d.start)return false;
  const y=yearOf(d.start),m=monthOf(d.start),w=_mondayOf(d.start);
  if(!o.ignorePeriod){
    if(_dashActive(DASH.years)&&!DASH.years.has(y))return false;
    if(!o.ignoreMonthWeek){
      if(_dashActive(DASH.months)&&!DASH.months.has(m))return false;
      if(_dashActive(DASH.weeks)&&!DASH.weeks.has(w))return false;
    }
  }
  if(DASH.channel&&(d.ch||d.influencer||'').trim()!==DASH.channel)return false;
  if(!o.ignoreTier){
    if(DASH.revTier&&DASH.revTier!=='all'&&effectiveTierOf(d)!==DASH.revTier)return false;
    if(DASH.followerTier&&DASH.followerTier!=='all'&&followerTierOf_(d)!==DASH.followerTier)return false;
  }
  if(!o.ignoreProduct&&!_dashProductMatch(d))return false;
  return true;
}
function dashData(){return DATA.filter(d=>d.start&&dashPeriodMatch(d));}

// ── 기간 필터 드롭다운 패널: body 직속 포탈 렌더링 ──
// 이전에 position:fixed만 적용했을 때도 패널이 잘리는 문제가 재발했음 — 원인은 overflow가 아니라
// .card{isolation:isolate}가 조상에 새 stacking context를 만들어서, fixed+z-index를 줘도 패널이
// 그 카드 내부 페인트 순서에 갇혀 이후에 오는 형제 카드(KPI/차트)에 덮여 보였던 것(실제 DOM 검사로 확인).
// 근본적으로 해결하려면 패널을 아예 .card 밖, document.body 직속 자식으로 렌더링해야 함 — 그러면
// 어떤 조상의 isolation/overflow와도 무관해짐. 트리거 버튼(.ym-dd)과 패널(.ym-dd-pop)이 더 이상
// 부모-자식 관계가 아니므로 id 매핑으로 서로를 찾음.
const YM_DD_POP_MAP={dashPYearDd:'dashPYearPop',dashPMonthDd:'dashPMonthPop',dashPWeekDd:'dashPWeekPop'};
Object.keys(YM_DD_POP_MAP).forEach(ddId=>{
  const pop=document.getElementById(YM_DD_POP_MAP[ddId]);
  if(pop)document.body.appendChild(pop);
});
// 인플루언서 자동완성 팝오버도 같은 이유(.card{isolation:isolate} 클리핑)로 body 직속으로 이동
['dashInfluencerPop','salesInfluencerPop'].forEach(id=>{
  const infPop=document.getElementById(id);
  if(infPop)document.body.appendChild(infPop);
});
