'use strict';
/* 품목별 실적 — 실적 상세 표(열·셀·정렬), 채널 링크 표시, 연/월 필터, KPI. */

/* 브랜드별 실적 표: 뱃지·정렬·토스트·열 표시 설정 */
// 브랜드는 사이드바에서 이미 필터되므로(항상 Minix) 표에는 표시하지 않음
const SALES_COLS=[
  {key:'product', lb:'제품명',  sticky:1},
  {key:'channel', lb:'채널명',  sticky:2},
  {key:'vendor',  lb:'소속(벤더사)'},
  {key:'platform',lb:'플랫폼'},
  {key:'price',   lb:'공동구매가', num:true},
  {key:'qty',     lb:'판매수량',   num:true},
  {key:'achieveRate', lb:'달성률', num:true},
  {key:'rev',     lb:'총매출',     num:true},
  {key:'comm',    lb:'수수료',     num:true},
  {key:'year',    lb:'연도',       num:true},
  {key:'period',  lb:'기간'},
  {key:'status',  lb:'진행상태'},
  {key:'views',   lb:'조회수',     num:true},
  {key:'code',    lb:'상품코드'},
  {key:'format',  lb:'포맷'},
  {key:'naverLink',lb:'링크'},
  {key:'note',    lb:'비고'}
];
const SALES_ACC={
  product:d=>d.product||'', vendor:d=>d.vendor||'', channel:d=>d.ch||'',
  platform:d=>d.platform||'', price:d=>d.s&&d.s.sale!=null?d.s.sale:-Infinity,
  qty:d=>d.qty!=null?d.qty:-Infinity,
  achieveRate:d=>(d.targetQty?d.qty!=null?d.qty/d.targetQty:-Infinity:-Infinity),
  rev:d=>d.rev!=null?d.rev:-Infinity,
  comm:d=>d.s&&d.s.comm!=null?d.s.comm:-Infinity, year:d=>yearOf(d.start)||0,
  period:d=>d.start||'', status:d=>_displayStatus(d), format:d=>d.format||'',
  views:d=>d.views!=null?d.views:-Infinity,
  code:d=>(d.codes&&d.codes[0])||'', naverLink:d=>(d.codes&&d.codes[0])||'',
  note:d=>(d.s&&d.s.note)||''
};
function colClass(c){return`${c.num?' num-col':''}${c.sticky===1?' sticky-col1':''}${c.sticky===2?' sticky-col2':''}`;}

// 상품코드(네이버 브랜드스토어 상품 번호)로 상품 페이지 링크 생성
function naverProductLink(code){
  const c=String(code||'').trim();
  if(!/^\d+$/.test(c))return'';
  return`https://brand.naver.com/minix/products/${c}`;
}
let SALES_SORT={key:null,dir:1};
function sortSales(key){
  if(SALES_SORT.key===key)SALES_SORT.dir*=-1;else{SALES_SORT.key=key;SALES_SORT.dir=1;}
  render();
}
function productBadge(p){
  const c=productColor(p);
  let label;
  if(isFlender(p))label=`더 플렌더 ${flenderModel(p)}`;
  else if(isShift(p))label=shiftModel(p)==='PRO'?'더 시프트 PRO':'더 시프트';
  else{
    const np=normP(p);
    if(np==='더슬림')label='더 슬림';
    else if(np.includes('에어드라이'))label='더 에어드라이';
    else label=p||'—';
  }
  return`<span class="bp" style="background:${c.bg};color:${c.fg}">${label}</span>`;
}
function formatBadge(f){
  if(!f)return'—';
  const c=formatColor(f);
  return`<span class="bp bp-fmt" style="background:${c.bg};color:${c.fg}">${f}</span>`;
}

/* ── 인플루언서 프로필 링크 (표시용) ────────────────────────────────────────────
   시트(인플루언서 링크 열)에 값이 있으면 그걸 쓰고, 없으면 플랫폼+ID로 모달과 **같은 규칙**으로
   즉석 생성한다. 예전엔 표가 시트 값만 보고 링크를 걸어서, 자동 생성은 모달에서 입력할 때만
   일어나는 기존 건들(시트 열이 빈 건)은 이름을 눌러도 아무 일도 없었다.
   저장된 링크와 즉석 생성 링크는 화면에서 구분하지 않는다 — 사용자에겐 같은 프로필이다. */
function getInfluencerLink(d){
  if(!d)return null;
  const saved=normalizeUrl(d.link)||normalizeUrl(d.profileLink);
  if(saved)return saved;
  const made=buildChannelLink(d.platform,_platformKind(d.platform)==='yt'?d.ytId:d.igId);
  if(made)return made;
  // 플랫폼 표기가 아예 없더라도 ID가 한쪽에만 있으면 그걸로 만든다(표기 누락이 흔하다)
  if(d.igId&&!d.ytId)return buildChannelLink('인스타그램',d.igId)||null;
  if(d.ytId&&!d.igId)return buildChannelLink('유튜브',d.ytId)||null;
  return null;
}
/* 채널 단위(집계 행)에서 쓰는 버전 — 그 채널의 공구건 중 링크를 만들 수 있는 최근 건을 따른다. */
function getChannelLinkByName(ch){
  const key=String(ch||'').trim();
  if(!key)return null;
  const rows=DATA.filter(d=>String(d.ch||d.influencer||'').trim()===key)
    .sort((a,b)=>String(b.start||'').localeCompare(String(a.start||'')));
  for(let i=0;i<rows.length;i++){const u=getInfluencerLink(rows[i]);if(u)return u;}
  return null;
}
// 채널명 셀 — 링크가 있으면 새 탭으로 열리는 이름, 없으면 그냥 이름
function chNameHtml(name,url,extra){
  const txt=String(name==null?'':name);
  if(!url)return txt+(extra||'');
  return`<a href="${_escAttr(url)}" target="_blank" rel="noopener" class="ch-name-link" onclick="event.stopPropagation()">${txt}</a>`+(extra||'');
}
function chCell(d){return chNameHtml(d&&(d.ch||d.influencer),getInfluencerLink(d));}

const SALES_CELL={
  product:d=>productBadge(d.product),
  channel:d=>{
    /* 링크 우선순위: ①시트에 저장된 링크 ②브랜드별 일정 시트 프로필 링크 ③플랫폼+ID로 즉석 생성.
       ③이 없어서 "시트에 링크가 없는 채널은 이름을 눌러도 반응이 없던" 문제가 있었다. */
    const chLink=getInfluencerLink(d);
    const id=d.chId||(_platformKind(d.platform)==='yt'?d.ytId:d.igId)||'';
    const idPart=id?`<span class="ch-id">${chLink?`<a href="${_escAttr(chLink)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">@${String(id).replace(/^@/,'')}</a>`:'@'+String(id).replace(/^@/,'')}</span>`:'';
    return chNameHtml(d.ch,chLink,idPart);
  },
  vendor:d=>d.vendor?`<span class="bp bp-vendor">${d.vendor}</span>`:'<span style="color:var(--text-3)">—</span>',
  platform:d=>d.platform||'—',
  price:d=>won(d.s&&d.s.sale),
  qty:d=>num(d.qty),
  achieveRate:d=>{
    if(!d.targetQty||d.qty==null)return'<span style="color:var(--text-3)">—</span>';
    const r=d.qty/d.targetQty*100;
    return`<span${r>=100?' style="color:var(--ok);font-weight:700"':''}>${r.toFixed(0)}%</span>`;
  },
  rev:d=>`<strong>${won(d.rev)}</strong>`,
  comm:d=>d.s&&d.s.comm!=null?d.s.comm+'%':'—',
  year:d=>yearOf(d.start)??'—',
  period:d=>`${fmtS(d.start)} ~ ${fmtS(d.end)}`,
  status:d=>bdg(_displayStatus(d))+_savingChip(d),
  views:d=>d.views!=null?d.views.toFixed(1)+'만':'<span style="color:var(--text-3)">—</span>',
  code:d=>{
    const codes=(d.codes||[]).filter(c=>c);
    if(!codes.length)return'<span style="color:var(--text-3)">—</span>';
    const first=`<span class="pcode" onclick="event.stopPropagation();cpTxt('${codes[0]}',this)">${codes[0]}</span>`;
    if(codes.length===1)return first;
    const popRows=codes.map(c=>`<div class="cd-pop-row"><span class="pcode-pop-code">${c}</span><button type="button" class="btn-cancel" style="padding:2px 8px;font-size:11px" onclick="event.stopPropagation();cpTxt('${c}',this)">복사</button></div>`).join('');
    return`${first} <span class="cd-dd" onclick="event.stopPropagation();toggleCodeDd(this)"><span class="bp cd-badge">+${codes.length-1}</span><div class="cd-dd-pop">${popRows}</div></span>`;
  },
  format:d=>formatBadge(d.format),
  naverLink:d=>{
    const c=(d.codes||[])[0];
    return naverProductLink(c)?`<a href="${naverProductLink(c)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="pcode-link">🔗 열기</a>`:'<span style="color:var(--text-3)">—</span>';
  },
  note:d=>(d.s&&d.s.note)?d.s.note:'<span style="color:var(--text-3)">—</span>'
};

function toggleCodeDd(el){
  const dd=el.closest('.cd-dd');
  const willOpen=!dd.classList.contains('open');
  document.querySelectorAll('.cd-dd.open').forEach(x=>x.classList.remove('open'));
  if(willOpen)dd.classList.add('open');
}
document.addEventListener('click',()=>{document.querySelectorAll('.cd-dd.open').forEach(x=>x.classList.remove('open'));});

/* ── 브랜드별 실적: 연도/월 다중선택 필터 ── */
// channel: 인플루언서 검색으로 고른 채널명(null=전체). 페이지 전환 때만 초기화되고
// 연·월 체크박스나 모델 탭을 바꿔도 유지됨(navSales 참고).
const SALES_YM={years:new Set(),months:new Set(),channel:null,_initialized:false};
function salesAvailableYears(){
  return[...new Set(DATA.filter(d=>d.start).map(d=>yearOf(d.start)))].sort((a,b)=>a-b);
}
// 연·월·인플루언서를 AND로 판정. KPI(renderSalesKpi)와 실적 상세 표(renderTbl)가 둘 다
// filteredProd(...).filter(salesYMMatch) 한 경로만 타므로, 필터가 한쪽에만 먹는 일이 없다.
// 모델 탭(ST.model)은 앞단 filteredProd가 이미 걸러낸 뒤라 여기선 다루지 않음.
function salesYMMatch(d){
  if(!d.start)return false;
  if(SALES_YM.channel&&_dashInfluencerNorm(d.ch||d.influencer||'')!==_dashInfluencerNorm(SALES_YM.channel))return false;
  return SALES_YM.years.has(yearOf(d.start))&&SALES_YM.months.has(monthOf(d.start));
}
function ymSelectAll(kind){
  if(kind==='years')SALES_YM.years=new Set(salesAvailableYears());
  else SALES_YM.months=new Set([1,2,3,4,5,6,7,8,9,10,11,12]);
  renderTbl();
}
function ymSelectNone(kind){
  SALES_YM[kind]=new Set();
  renderTbl();
}
function toggleYM(kind,val,checked){
  if(checked)SALES_YM[kind].add(val);else SALES_YM[kind].delete(val);
  renderTbl();
}
function renderYMFilterBar(){
  const years=salesAvailableYears();
  if(!SALES_YM._initialized){
    SALES_YM.years=new Set(years);
    SALES_YM.months=new Set([1,2,3,4,5,6,7,8,9,10,11,12]);
    SALES_YM._initialized=true;
  }
  document.getElementById('yearChkList').innerHTML=years.map(y=>`
    <label class="ym-chk"><input type="checkbox" ${SALES_YM.years.has(y)?'checked':''} onchange="toggleYM('years',${y},this.checked)">${y}</label>`).join('')||'<span style="font-size:11px;color:var(--text-3)">데이터 없음</span>';
  document.getElementById('monthChkList').innerHTML=Array.from({length:12},(_,i)=>i+1).map(m=>`
    <label class="ym-chk"><input type="checkbox" ${SALES_YM.months.has(m)?'checked':''} onchange="toggleYM('months',${m},this.checked)">${m}월</label>`).join('');

  const chips=[];
  if(years.length&&SALES_YM.years.size===years.length)chips.push({all:true,lbl:'연도: 전체'});
  else[...SALES_YM.years].sort((a,b)=>a-b).forEach(y=>chips.push({type:'years',val:y,lbl:y+'년'}));
  if(SALES_YM.months.size===12)chips.push({all:true,lbl:'월: 전체'});
  else[...SALES_YM.months].sort((a,b)=>a-b).forEach(m=>chips.push({type:'months',val:m,lbl:m+'월'}));
  const ymChipHtml=chips.map(c=>c.all?
    `<span class="ym-chip ym-chip-all">${c.lbl}</span>`:
    `<span class="ym-chip">${c.lbl}<button onclick="toggleYM('${c.type}',${c.val},false)">✕</button></span>`
  ).join('');
  // 인플루언서 칩은 기간 칩과 같은 줄 맨 끝에. 해제 버튼은 옆 칩들과 같은 ✕로 통일.
  const infChipHtml=SALES_YM.channel
    ?`<span class="ym-chip">인플루언서: ${_escHtml(SALES_YM.channel)}<button onclick="_clearInfSearch('sales')" title="필터 해제">✕</button></span>`
    :'';
  document.getElementById('ymChips').innerHTML=ymChipHtml+infChipHtml;
}

/* 실적 상세 표 상단 KPI (연도/월 필터 반영) */
function renderSalesKpi(){
  const f=filteredProd(DATA).filter(salesYMMatch);
  const tRev=f.reduce((s,d)=>s+(d.rev||0),0);
  const tQty=f.reduce((s,d)=>s+(d.qty||0),0);
  const withViews=f.filter(d=>d.views!=null);
  const avgViews=withViews.length?withViews.reduce((s,d)=>s+d.views,0)/withViews.length:0;
  document.getElementById('salesKpiRow').innerHTML=`
    <div class="kpi"><div class="kpi-lbl">총 매출</div><div class="kpi-val cm">${tRev?won(tRev):'—'}</div><div class="kpi-sub">${f.length}건</div></div>
    <div class="kpi"><div class="kpi-lbl">총 판매수량</div><div class="kpi-val cn">${tQty?num(tQty)+'<span class="kpi-unit">개</span>':'—'}</div><div class="kpi-sub">선택된 기간 기준</div></div>
    <div class="kpi"><div class="kpi-lbl">평균 릴스 조회수</div><div class="kpi-val cm">${avgViews?avgViews.toFixed(1)+'<span class="kpi-unit">만</span>':'—'}</div><div class="kpi-sub">조회수 등록 건 기준</div></div>`;
}

function renderTbl(){
  renderYMFilterBar();
  renderSalesKpi();

  document.getElementById('tHead').innerHTML=SALES_COLS.map(c=>
    sortableThHtml(c,{sorted:SALES_SORT.key===c.key,dir:SALES_SORT.dir,
      onclick:`sortSales('${c.key}')`})).join('');

  const f=filteredProd(DATA).filter(salesYMMatch);
  if(SALES_SORT.key){
    const acc=SALES_ACC[SALES_SORT.key];
    f.sort((a,b)=>{
      const va=acc(a),vb=acc(b);
      const cmp=(typeof va==='number'&&typeof vb==='number')?va-vb:String(va).localeCompare(String(vb));
      return cmp*SALES_SORT.dir;
    });
  } else {
    f.sort((a,b)=>new Date(b.end)-new Date(a.end));
  }

  // [모달진단] 지금 실제로 그려지는 목록의 (인덱스, dealId, 채널, 제품) 전체 — 클릭 시 로그와 대조용
  console.log('[모달진단] renderTbl 목록('+f.length+'건):',f.map((d,i)=>({idx:i,dealId:d.dealId,ch:d.ch,product:d.product})));

  // dealId가 비어있으면(정상적으로는 발생하지 않아야 함 — 방어적 처리) 조용히 실패하는 대신
  // "미연결" 배지를 붙이고 클릭을 막음
  document.getElementById('tBody').innerHTML=f.length?f.map(d=>d.dealId?`
    <tr data-id="${d.dealId}" data-ch="${_escAttr(d.ch)}" data-product="${_escAttr(d.product)}" onclick="openM('${d.dealId}',this)">
      ${SALES_COLS.map(c=>`<td class="${colClass(c)}">${SALES_CELL[c.key](d)}</td>`).join('')}
    </tr>`:`
    <tr data-ch="${_escAttr(d.ch)}" data-product="${_escAttr(d.product)}">
      ${SALES_COLS.map((c,i)=>i===0?`<td class="${colClass(c)}">${SALES_CELL[c.key](d)} <span class="f-badge">미연결</span></td>`:`<td class="${colClass(c)}">${SALES_CELL[c.key](d)}</td>`).join('')}
    </tr>`).join(''):`<tr><td colspan="${SALES_COLS.length}" style="text-align:center;padding:40px;color:var(--text-3)">데이터 없음</td></tr>`;
}
