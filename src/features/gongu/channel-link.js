'use strict';
/* 인플루언서 채널 링크 — 플랫폼 표기 정규화, ID 입력 파싱, 프로필 URL 생성/역추출. */

/* 플랫폼 표기를 'ig'/'yt'로 정규화한다. 시트에는 '인스타', 'IG', '인스타그램 릴스'처럼
   표기가 제각각인 값이 들어 있고, 그대로 비교하면 링크 자동 생성이 통째로 죽는다
   (select에 없는 값을 넣으면 value가 ''이 되므로 판정이 항상 실패했다 — 2026-09-15 원인). */
function _platformKind(platform){
  const t=String(platform||'').trim().toLowerCase().replace(/\s+/g,'');
  if(!t)return'';
  if(t.indexOf('인스타')>=0||t.indexOf('instagram')>=0||t==='ig'||t.indexOf('릴스')>=0||t.indexOf('reels')>=0)return'ig';
  if(t.indexOf('유튜브')>=0||t.indexOf('유툽')>=0||t.indexOf('youtube')>=0||t==='yt'||t.indexOf('쇼츠')>=0||t.indexOf('shorts')>=0)return'yt';
  return'';
}
/* ID 입력값 정규화 — 앞뒤 공백과 앞의 @를 떼고, URL을 통째로 붙여넣은 경우엔 ID만 뽑는다.
   반환 {id, url}: url은 "붙여넣은 주소를 그대로 링크로 쓸 것"이라는 뜻(없으면 빈 문자열). */
function _parseChannelIdInput(platform,raw){
  const t=String(raw==null?'':raw).trim();
  if(!t)return{id:'',url:''};
  if(/^(https?:\/\/|www\.|instagram\.com|youtube\.com|youtu\.be)/i.test(t)){
    const kind=_platformKind(platform);
    const fromUrl=_extractChannelIdFromLink(kind==='yt'?'유튜브':'인스타그램',t);
    if(fromUrl)return{id:fromUrl,url:normalizeUrl(t)};
    // 주소 같긴 한데 ID를 못 뽑으면 링크로만 쓰고 ID 칸은 건드리지 않는다
    return{id:'',url:normalizeUrl(t)};
  }
  return{id:t.replace(/^@+/,''),url:''};
}
// 채널 링크: 플랫폼+ID로 프로필 URL 생성 (@ 접두사는 제거)
function buildChannelLink(platform,id){
  const v=_parseChannelIdInput(platform,id).id;
  if(!v)return'';
  const kind=_platformKind(platform);
  if(kind==='ig')return`https://www.instagram.com/${v}`;
  if(kind==='yt')return`https://www.youtube.com/@${v}`;
  return'';
}
// buildChannelLink의 역방향 — 링크에서 플랫폼별 ID를 추출(모달에 기존 링크를 불러올 때
// "인스타그램/유튜브 ID" 필드를 자동으로 채우는 데 씀). 인식 못 하면 빈 문자열.
function _extractChannelIdFromLink(platform,url){
  if(!url)return'';
  try{
    const u=new URL(normalizeUrl(url));
    const host=u.hostname.replace(/^www\./,'');
    const path=u.pathname.replace(/^\/+|\/+$/g,'');
    const seg=path.split('/')[0]||'';
    const kind=_platformKind(platform);
    if(kind==='ig'&&host==='instagram.com')return seg;
    if(kind==='yt'&&(host==='youtube.com'||host==='youtu.be'))return seg.replace(/^@/,'');
  }catch(e){}
  return'';
}
// instagram.com/... 처럼 프로토콜이 빠진 링크에 https://를 자동으로 붙여줌
function normalizeUrl(u){
  const s=String(u||'').trim();
  if(!s)return'';
  if(/^https?:\/\//i.test(s))return s;
  return'https://'+s.replace(/^\/+/,'');
}
