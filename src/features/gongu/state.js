'use strict';
/* 공구 데이터 전역 상태 — 샘플 데이터, DATA/EVENTS, 품목별 실적(ST)·공구 분석(DASH) 필터 상태. */

const SAMPLE=[
  {id:1,brand:'Minix',product:'더 플렌더 PRO',ch:'민이',followers:128000,platform:'인스타그램',chId:'minnie.life',link:'https://www.instagram.com/minnie.life',start:'2026-05-05',end:'2026-05-07',status:'완료',views:28.6,qty:234,rev:6997800,code:'MX-BLD-001',s:{retail:39900,sale:32900,comm:12,note:'상위 50개 구매자 추가 증정품 제공'},reels:[{url:'https://www.instagram.com/reel/sample1/',views:18.2,thumb:''},{url:'https://www.instagram.com/reel/sample2/',views:10.4,thumb:''}]},
  {id:2,brand:'Minix',product:'더시프트',ch:'데일리핏',followers:1450000,platform:'유튜브',chId:'everyday_fit',start:'2026-05-12',end:'2026-05-14',status:'완료',views:19.8,qty:178,rev:4539000,code:'MX-SHF-001',s:{retail:35900,sale:29900,comm:11,note:'공구 전용 증정품 세트 포함'}},
  {id:3,brand:'Minix',product:'더 플렌더 MAX',ch:'헤어러브제이',followers:42000,platform:'인스타그램',chId:'hairlove_j',start:'2026-05-20',end:'2026-05-22',status:'완료',views:41.2,qty:389,rev:15170100,code:'MX-BLD-002',s:{retail:52900,sale:42900,comm:13,note:'인스타 전용 · 상위 달성 시 +3% 보너스'}},
  {id:4,brand:'Minix',product:'더슬림',ch:'슬림데일리',followers:7600,platform:'인스타그램',chId:'slim.daily',start:'2026-05-27',end:'2026-05-29',status:'완료',views:15.6,qty:145,rev:3770000,code:'MX-SLM-001',s:{retail:32900,sale:28900,comm:11,note:'기본 스킴 적용'}},
  {id:5,brand:'Minix',product:'더 플렌더 PRO',ch:'키친퀸',tier:'메가',followers:310000,platform:'인스타그램',chId:'kitchen_queen',start:'2026-06-10',end:'2026-06-12',status:'완료',views:33.4,qty:298,rev:8910200,code:'MX-BLD-001',s:{retail:39900,sale:32900,comm:12,note:'상위 50개 구매자 추가 증정품 제공'}},
  {id:6,brand:'Minix',product:'더시프트',ch:'데일리팁스',followers:96000,platform:'유튜브',chId:'daily.tips',start:'2026-06-24',end:'2026-06-26',status:'진행중',views:27.8,qty:241,rev:9400000,code:'MX-SHF-002',s:{retail:35900,sale:29900,comm:11,note:'공구 전용 증정품 세트 포함'}},
  {id:7,brand:'Minix',product:'더 플렌더 MAX',ch:'뷰티노트',platform:'인스타그램',chId:'beauty.note',start:'2026-07-02',end:'2026-07-04',status:'예정',views:null,qty:null,rev:null,code:'MX-BLD-002',s:{retail:59900,sale:49900,comm:14,note:'신규 채널 기본 스킴'}},
  {id:8,brand:'Minix',product:'더슬림',ch:'핏푸디',platform:'인스타그램',chId:'fit.foodie',start:'2026-07-08',end:'2026-07-10',status:'예정',views:null,qty:null,rev:null,code:'MX-SLM-001',s:{retail:32900,sale:28900,comm:11,note:'기본 스킴 적용'}},
];
SAMPLE.forEach(d=>{d.link=buildChannelLink(d.platform,d.chId);});
let DATA=SAMPLE.map(d=>({...d}));

// 캘린더 "프로모션/이벤트 일정" — 공구 실적과 완전히 분리된 별도 데이터 (실적/KPI/품목별 실적에 집계되지 않음)
const SAMPLE_EVENTS=[
  {id:1,name:'미닉스 세일즈 페스타',start:'2026-06-15',end:'2026-06-21',note:'전 품목 라이브 방송 진행'},
];
let EVENTS=SAMPLE_EVENTS.map(e=>({...e}));

const _NOW=new Date();
const ST={prod:'all',model:'all'};
const DASH_PERIOD_LS_KEY='gp_dash_period';
// channel: null=전체, 문자열=해당 인플루언서(채널명)만
// revTier/followerTier: 'all'=전체, 그 외는 해당 등급만 — 두 등급 필터는 서로 AND로 조합됨
// (기간 3종만 localStorage에 저장 — channel/등급 2종은 세션 내 임시 필터라 새로고침 시 전체로 돌아감)
// product: 'all' | 'line:<라인키>' | 'fine:<모델키>' — 기간과 함께 localStorage에 저장됨
const DASH={years:null,months:null,weeks:null,channel:null,revTier:'all',followerTier:'all',product:'all'};
function dashPLoad(){
  try{
    const raw=localStorage.getItem(DASH_PERIOD_LS_KEY);
    if(!raw)return;
    const o=JSON.parse(raw);
    DASH.years=(o.years==null)?null:new Set(o.years);
    DASH.months=(o.months==null)?null:new Set(o.months);
    DASH.weeks=(o.weeks==null)?null:new Set(o.weeks);
    if(typeof o.product==='string')DASH.product=o.product;
  }catch(e){}
}
function dashPSave(){
  try{
    localStorage.setItem(DASH_PERIOD_LS_KEY,JSON.stringify({
      years:DASH.years===null?null:[...DASH.years],
      months:DASH.months===null?null:[...DASH.months],
      weeks:DASH.weeks===null?null:[...DASH.weeks],
      product:DASH.product
    }));
  }catch(e){}
}
dashPLoad();
