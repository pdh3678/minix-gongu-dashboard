'use strict';
/* 공용 포맷터(금액·수량·날짜)와 HTML 이스케이프. */

const won=n=>n==null?'—':'₩'+n.toLocaleString('ko-KR');
const num=n=>n==null?'—':n.toLocaleString('ko-KR');
const fmtS=s=>{const d=new Date(s+'T00:00:00');return`${d.getMonth()+1}/${d.getDate()}`};
const fmtF=s=>{const d=new Date(s+'T00:00:00');return`${d.getFullYear()}. ${d.getMonth()+1}. ${d.getDate()}.`};
const yearOf=s=>s?new Date(s+'T00:00:00').getFullYear():null;
const monthOf=s=>s?new Date(s+'T00:00:00').getMonth()+1:null;
const durDays=(s,e)=>{if(!s||!e)return null;const sd=new Date(s+'T00:00:00'),ed=new Date(e+'T00:00:00');return Math.round((ed-sd)/86400000)+1;};

// 속성값에 쓰인 큰따옴표가 HTML을 깨뜨리지 않도록 최소 이스케이프(진단용 data-* 속성 전용)
function _escAttr(s){return String(s||'').replace(/"/g,'&quot;');}

// 텍스트를 HTML 본문에 넣을 때 — 채널명·제품명에 <, & 가 섞여 있어도 마크업이 깨지지 않게
function _escHtml(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
