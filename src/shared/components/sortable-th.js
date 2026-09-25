'use strict';
/* 정렬 가능한 표 헤더 셀 공용 컴포넌트. */

/* ── 정렬 가능한 표 헤더 셀(공용) ──────────────────────────────────────────────
   채널별 성과 / 개별 공구 건 / 실적 표 세 곳이 같은 컬럼 정의로 <th>를 만든다.
   예전엔 세 곳이 각자 문자열을 조립했고(채널 표는 아예 HTML에 박혀 있었다), 그래서
   헤더에 뭔가 하나 추가하려면 세 군데를 따로 고쳐야 했다.

   컬럼 정의 필드
     lb        주 라벨(첫 줄)
     subLabel  보조 라벨(둘째 줄, 작은 회색 글씨). 있으면 두 줄 헤더가 되어 열 폭이 줄어든다.
               예: {key:'count', lb:'공구 횟수', subLabel:'(기간 내)'}
     info      ⓘ 툴팁 문구. 함수를 주면 렌더 시점에 호출한다(내용이 상황에 따라 바뀌는 경우).
     num/sticky  colClass가 해석하는 기존 필드 그대로

   ⚠ 정렬 아이콘(⇕)과 ⓘ는 반드시 **첫 줄 끝**에 붙인다. 보조 라벨이 아래로 내려가도
   아이콘은 한 줄 헤더와 같은 높이·같은 자리에 남아, 헤더 행에서 아이콘 줄이 어긋나 보이지 않는다. */
function sortableThHtml(c,o){
  o=o||{};
  const info=typeof c.info==='function'?c.info():c.info;
  const infoHtml=info?`<span class="hd-info" title="${_escAttr(info)}" onclick="event.stopPropagation()">ⓘ</span>`:'';
  const sortHtml=o.onclick?`<span class="sort-ic">${o.sorted?(o.dir>0?'▲':'▼'):'⇕'}</span>`:'';
  const head=`${_escHtml(c.lb)}${infoHtml}${sortHtml}`;
  const inner=c.subLabel
    ?`<span class="th-lb">${head}<span class="th-sub">${_escHtml(c.subLabel)}</span></span>`
    :head;
  const cls=`${o.onclick?'sortable':''}${o.sorted?' sorted':''}${colClass(c)}${c.subLabel?' th-2line':''}`.trim();
  return `<th class="${cls}"${o.onclick?` onclick="${o.onclick}"`:''}>${inner}</th>`;
}
