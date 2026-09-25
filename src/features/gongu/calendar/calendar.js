'use strict';
/* 공구 캘린더 — 연/월 접기 상태, 월 그리드·레인 배치, 프로모션 행. */

/* ── 공구 캘린더 페이지 ── */
// 우상단 액션 — 기존 등록 모달을 그대로 연다(시작일 기본값은 오늘, 날짜 칸으로 열면 그 날짜)
renderPageHeaderActions('calPageActions',[{label:'＋ 새 공구건 등록',onclick:'openDealForm()'}]);

// 제품 그룹 키/라벨/막대색 (더플렌더는 모델별로 구분)
function calProductKey(p){
  if(isFlender(p))return'플렌더'+flenderModel(p);
  const np=normP(p);
  if(np==='더시프트')return'시프트';
  if(np.includes('에어드라이'))return'에어드라이';
  if(np==='더슬림')return'슬림';
  return np;
}
function calProductLabel(p){
  if(isFlender(p))return`더 플렌더 ${flenderModel(p)}`;
  const np=normP(p);
  if(np==='더시프트')return'더 시프트';
  if(np.includes('에어드라이'))return'더 에어드라이';
  if(np==='더슬림')return'더 슬림';
  return p;
}
function calBarColor(p){return productColor(p);}

// 같은 제품 안에서 날짜가 겹치는 공구를 레인(서브 행)으로 나눠 배치 — 시작일 순 그리디 배치.
// items의 각 원소는 {sd,ed,...}(시작/종료 Date)를 가져야 하며, 배치 결과로 x.lane(0-based)이 채워짐.
// 겹침 판정: 새 공구 시작일이 기존 레인의 마지막 종료일보다 "이후"여야 그 레인에 배치 가능
// (시작일 == 종료일이면 겹침으로 처리 — 같은 칸에 두 막대가 반씩 들어가지 않게 함)
function calAssignLanes(items){
  items.sort((a,b)=>a.sd-b.sd);
  const laneEndDates=[];
  items.forEach(x=>{
    let lane=laneEndDates.findIndex(endDt=>x.sd.getTime()>endDt.getTime());
    if(lane<0){lane=laneEndDates.length;laneEndDates.push(null);}
    laneEndDates[lane]=x.ed;
    x.lane=lane;
  });
  return laneEndDates.length;
}

/* ── 캘린더 연도/월 접기·펼치기 상태 ──
   localStorage에 저장 → 새로고침해도 상태 보존. 쿼리스트링(?calOpen=...)은 더 이상 쓰지 않음 —
   과거 버전이 남긴 게 있으면 최초 로드 시 한 번만 읽어 반영한 뒤 주소에서 제거함(_migrateLegacyCalOpen).
   Set에 들어있는 키는 "펼쳐진" 연도/월을 의미(연도="2025", 월="2025-01") */
const CAL_STATE={years:new Set(),months:new Set()};
let _calStateLoaded=false,_calScrolled=false;
const CAL_OPEN_LS_KEY='gp_cal_open';

function calDefaultOpenState(){
  const today=new Date();
  const cy=today.getFullYear(),cm=today.getMonth()+1;
  const years=new Set([String(cy)]);
  const months=new Set();
  for(let d=-1;d<=1;d++){
    const dt=new Date(cy,cm-1+d,1);
    months.add(dt.getFullYear()+'-'+_pad2(dt.getMonth()+1));
  }
  return{years,months};
}
function calSaveState(){
  const keys=[...CAL_STATE.years,...CAL_STATE.months];
  localStorage.setItem(CAL_OPEN_LS_KEY,keys.join(','));
}
// 과거 버전이 쓰던 ?calOpen=... 쿼리스트링이 주소에 남아있으면 한 번 읽어서 반영하고 즉시 제거.
// 쿼리스트링은 어떤 경우에도 주소에 남지 않아야 하므로, 해시는 보존한 채 replaceState로 정리함.
function _migrateLegacyCalOpen(){
  const params=new URLSearchParams(location.search);
  if(!params.has('calOpen'))return null;
  const raw=params.get('calOpen');
  const keys=raw?raw.split(','):[];
  /* calOpen만 걷어내고 나머지 쿼리는 남긴다 — 예전엔 쿼리스트링을 통째로 지워서, 임베드로 들어온
     주소에 calOpen이 섞여 있으면 ?embed=1까지 같이 날아갔다(사이드바가 다시 튀어나옴). */
  params.delete('calOpen');
  const rest=params.toString();
  history.replaceState(null,'',location.pathname+(rest?'?'+rest:'')+location.hash);
  return keys;
}
function calLoadState(){
  const legacyKeys=_migrateLegacyCalOpen();
  let keys=legacyKeys;
  if(keys===null){
    const saved=localStorage.getItem(CAL_OPEN_LS_KEY);
    keys=saved===null?null:(saved?saved.split(','):[]);
  }
  if(keys===null){
    const def=calDefaultOpenState();
    CAL_STATE.years=def.years;CAL_STATE.months=def.months;
    calSaveState();
    return;
  }
  CAL_STATE.years=new Set(keys.filter(k=>/^\d{4}$/.test(k)));
  CAL_STATE.months=new Set(keys.filter(k=>/^\d{4}-\d{2}$/.test(k)));
  calSaveState(); // 레거시 쿼리에서 읽어온 경우 localStorage에도 반영
}
function calToggleYear(y){
  const key=String(y);
  if(CAL_STATE.years.has(key))CAL_STATE.years.delete(key);else CAL_STATE.years.add(key);
  calSaveState();
  renderCalendarPage();
}
function calToggleMonth(y,m){
  const key=y+'-'+_pad2(m);
  if(CAL_STATE.months.has(key))CAL_STATE.months.delete(key);else CAL_STATE.months.add(key);
  calSaveState();
  renderCalendarPage();
}
function calAutoScrollToCurrentMonth(){
  if(_calScrolled)return;
  _calScrolled=true;
  const today=new Date();
  const key=today.getFullYear()+'-'+_pad2(today.getMonth()+1);
  requestAnimationFrame(()=>{
    const el=document.querySelector(`[data-ym="${key}"]`);
    if(el)el.scrollIntoView({block:'start'});
  });
}

// 월별 주차 계산: 해당 월의 첫 월요일부터 시작, 마지막 주는 다음달로 넘어가도 7일 채움
function monthWeeks(y,m){
  const dim=new Date(y,m,0).getDate();
  const monthEnd=new Date(y,m-1,dim);
  const start=new Date(y,m-1,1);
  const startDow=(start.getDay()+6)%7; // 월=0 ~ 일=6
  let cur=new Date(y,m-1,1+(startDow===0?0:7-startDow));
  const weeks=[];
  while(cur<=monthEnd){
    const week=[];
    for(let i=0;i<7;i++)week.push(new Date(cur.getFullYear(),cur.getMonth(),cur.getDate()+i));
    weeks.push(week);
    cur=new Date(cur.getFullYear(),cur.getMonth(),cur.getDate()+7);
  }
  return weeks;
}

function renderCalendarPage(){
  if(!_calStateLoaded){calLoadState();_calStateLoaded=true;}
  const host=document.getElementById('calPageBody');
  // 공구 일정은 실적통합(DATA) 기준 — 프로모션 일정(EVENTS)은 그대로 별도 표시
  const withDates=DATA.filter(d=>d.start);
  const eventsWithDates=EVENTS.filter(e=>e.start);
  if(!withDates.length&&!eventsWithDates.length){host.innerHTML='<div class="page-placeholder">표시할 공구 일정이 없습니다</div>';return;}

  let minY=Infinity,minM=13,maxY=-Infinity,maxM=0;
  withDates.concat(eventsWithDates).forEach(d=>{
    const sy=yearOf(d.start),sm=monthOf(d.start);
    const ey=yearOf(d.end||d.start)||sy,em=monthOf(d.end||d.start)||sm;
    if(sy<minY||(sy===minY&&sm<minM)){minY=sy;minM=sm;}
    if(ey>maxY||(ey===maxY&&em>maxM)){maxY=ey;maxM=em;}
  });

  let html='',lastYear=null,y=minY,m=minM;
  while(y<maxY||(y===maxY&&m<=maxM)){
    if(y!==lastYear){
      if(lastYear!==null)html+='</div>';
      const yOpen=CAL_STATE.years.has(String(y));
      html+=`<div class="cal-year-hd" onclick="calToggleYear(${y})"><span class="cal-hd-arrow">${yOpen?'▾':'▸'}</span>${y}년</div>`;
      html+=`<div class="cal-year-body" style="display:${yOpen?'block':'none'}">`;
      lastYear=y;
    }
    html+=renderCalMonth(y,m);
    m++; if(m>12){m=1;y++;}
  }
  if(lastYear!==null)html+='</div>';
  host.innerHTML=html;
  calAutoScrollToCurrentMonth();
}

function renderCalMonth(y,m){
  const weeks=monthWeeks(y,m);
  const gridDays=weeks.flat();
  const totalCols=gridDays.length;
  // 60px(MINIX 뱃지/★)+110px(제품명/프로모션) — .cal-lbl2/.cal-rowlbl의 nth-child(2) left 값과 반드시 같이 맞출 것
  const colsTpl=`60px 110px repeat(${totalCols},minmax(30px,1fr))`;
  const today=new Date();today.setHours(0,0,0,0);

  // 왼쪽 라벨 영역(뱃지+제품명 두 칸)을 병합해 각 헤더 행이 무엇을 나타내는지 표기(2026-08-18)
  let hdA=`<div class="cal-lbl2 cal-lbl2-hd" style="grid-column:1/3">주차</div>`;
  weeks.forEach((w,i)=>hdA+=`<div class="cal-wk" style="grid-column:span 7">${i+1}주</div>`);
  let hdB=`<div class="cal-lbl2 cal-lbl2-hd" style="grid-column:1/3">요일</div>`;
  const DOWS=['월','화','수','목','금','토','일'];
  weeks.forEach(()=>DOWS.forEach((dw,i)=>hdB+=`<div class="cal-dow2${i===5?' sat':i===6?' sun':''}">${dw}</div>`));
  let hdC=`<div class="cal-lbl2 cal-lbl2-hd" style="grid-column:1/3">날짜</div>`;
  gridDays.forEach(dt=>{
    const isToday=dt.getTime()===today.getTime();
    const dow=dt.getDay();
    const outMonth=dt.getMonth()+1!==m;
    // 날짜 칸을 누르면 그 날짜를 시작일로 새 공구건 등록(2026-09-25) — 이 칸엔 원래 클릭 동작이 없었다
    const ymd=`${dt.getFullYear()}-${_pad2(dt.getMonth()+1)}-${_pad2(dt.getDate())}`;
    hdC+=`<div class="cal-date2${dow===6?' sat':dow===0?' sun':''}${isToday?' today':''}${outMonth?' om':''}"`+
      ` onclick="openDealForm({start:'${ymd}'})" title="${dt.getMonth()+1}월 ${dt.getDate()}일 시작으로 새 공구건 등록">${dt.getDate()}</div>`;
  });

  const monthStart=gridDays[0],monthEnd=gridDays[gridDays.length-1];
  const rowsMap=new Map();
  DATA.forEach(d=>{
    if(!d.start)return;
    const sd=new Date(d.start+'T00:00:00'),ed=new Date((d.end||d.start)+'T00:00:00');
    if(ed<monthStart||sd>monthEnd)return;
    const key=calProductKey(d.product);
    if(!rowsMap.has(key))rowsMap.set(key,{label:calProductLabel(d.product),deals:[]});
    rowsMap.get(key).deals.push(d);
  });

  let rowsHtml=renderCalPromoRow(EVENTS,monthStart,monthEnd,gridDays,colsTpl);
  [...rowsMap.values()].sort((a,b)=>a.label.localeCompare(b.label)).forEach(row=>{
    // 그리드 위치(startIdx/endIdx) 계산 후 겹치는 공구는 레인(서브 행)을 나눠 배치
    const withPos=row.deals.map(d=>{
      const sd=new Date(d.start+'T00:00:00'),ed=new Date((d.end||d.start)+'T00:00:00');
      let startIdx=gridDays.findIndex(dt=>dt.getTime()>=sd.getTime());
      if(startIdx<0)startIdx=0;
      let endIdx=-1;
      for(let i=gridDays.length-1;i>=0;i--){if(gridDays[i].getTime()<=ed.getTime()){endIdx=i;break;}}
      return{d,sd,ed,startIdx,endIdx};
    }).filter(x=>x.endIdx>=0&&x.startIdx<=x.endIdx);
    const laneCount=calAssignLanes(withPos)||1;

    let bars=`<div class="cal-rowlbl" style="grid-column:1;grid-row:1/-1">${brandPill('Minix')}</div><div class="cal-rowlbl" style="grid-column:2;grid-row:1/-1">${row.label}</div>`;
    for(let ln=1;ln<laneCount;ln++)bars+=`<div class="cal-lane-sep" style="grid-column:1/-1;grid-row:${ln+1}"></div>`;
    withPos.forEach(x=>{
      const qtyTxt=x.d.qty!=null?`(${num(x.d.qty)})`:'';
      // dealId가 비어있으면(정상적으로는 발생하지 않아야 함 — 방어적 처리) 클릭을 막고 미연결임을 표시
      const fullTxt=x.d.dealId?`${x.d.ch}${qtyTxt}`:`⚠ 미연결 ${x.d.ch}${qtyTxt}`;
      const onclickAttr=x.d.dealId?`onclick="openM('${x.d.dealId}',this)"`:'';
      bars+=`<div class="cal-bar" data-ch="${_escAttr(x.d.ch)}" data-product="${_escAttr(x.d.product)}" style="grid-column:${x.startIdx+3}/${x.endIdx+4};grid-row:${x.lane+1};background:${calBarColor(x.d.product).bg};color:${calBarColor(x.d.product).fg}" ${onclickAttr} title="${fullTxt}">${fullTxt}</div>`;
    });
    rowsHtml+=`<div class="cal-row" style="grid-template-columns:${colsTpl};grid-template-rows:repeat(${laneCount},minmax(30px,auto))">${bars}</div>`;
  });

  const monthKey=y+'-'+_pad2(m);
  const mOpen=CAL_STATE.months.has(monthKey);
  return`
    <div class="cal-month-hd" onclick="calToggleMonth(${y},${m})" data-ym="${monthKey}"><span class="cal-hd-arrow">${mOpen?'▾':'▸'}</span>${y}년 ${m}월</div>
    <div class="cal-month-body" style="display:${mOpen?'block':'none'}">
      <div class="cal-scroll">
        <div class="cal-grid-hd" style="grid-template-columns:${colsTpl}">${hdA}${hdB}${hdC}</div>
        ${rowsHtml||'<div style="padding:16px;text-align:center;color:var(--text-3);font-size:12px">이 달은 등록된 공구가 없습니다</div>'}
      </div>
    </div>
  `;
}

// 프로모션/이벤트 일정 레인 — 항상 제품 행보다 위(달의 최상단)에 표시, 제품 팔레트와 무관한 고정 색상(.cal-bar-promo)
function renderCalPromoRow(events,monthStart,monthEnd,gridDays,colsTpl){
  const withPos=events.filter(e=>e.start).map(e=>{
    const sd=new Date(e.start+'T00:00:00'),ed=new Date((e.end||e.start)+'T00:00:00');
    if(ed<monthStart||sd>monthEnd)return null;
    let startIdx=gridDays.findIndex(dt=>dt.getTime()>=sd.getTime());
    if(startIdx<0)startIdx=0;
    let endIdx=-1;
    for(let i=gridDays.length-1;i>=0;i--){if(gridDays[i].getTime()<=ed.getTime()){endIdx=i;break;}}
    return{d:e,sd,ed,startIdx,endIdx};
  }).filter(x=>x&&x.endIdx>=0&&x.startIdx<=x.endIdx);
  if(!withPos.length)return'';
  const laneCount=calAssignLanes(withPos)||1;

  let bars=`<div class="cal-rowlbl cal-rowlbl-promo" style="grid-column:1;grid-row:1/-1">★</div><div class="cal-rowlbl cal-rowlbl-promo" style="grid-column:2;grid-row:1/-1">프로모션</div>`;
  for(let ln=1;ln<laneCount;ln++)bars+=`<div class="cal-lane-sep" style="grid-column:1/-1;grid-row:${ln+1}"></div>`;
  withPos.forEach(x=>{
    bars+=`<div class="cal-bar cal-bar-promo" style="grid-column:${x.startIdx+3}/${x.endIdx+4};grid-row:${x.lane+1}" onclick="openPromoEdit(${x.d.id})" title="${x.d.name}">★ ${x.d.name}</div>`;
  });
  return`<div class="cal-row cal-row-promo" style="grid-template-columns:${colsTpl};grid-template-rows:repeat(${laneCount},minmax(30px,auto))">${bars}</div>`;
}
