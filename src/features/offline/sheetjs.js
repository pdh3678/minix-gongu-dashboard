'use strict';
/* SheetJS(엑셀 읽기) 지연 로더 — 버전 고정 CDN <script> + SRI.

   왜 index.html의 정적 태그가 아닌가: 약 950KB라, 데이터 업로드를 쓰지 않는 대다수 사용자(공구 화면)가
   매 접속마다 받게 된다. 업로드 화면에서 처음 파일을 읽을 때 한 번만 붙인다.
   왜 cdn.sheetjs.com인가: npm 레지스트리의 xlsx는 0.18.5에서 멈춰 있고 알려진 취약점(프로토타입 오염
   CVE-2023-30533, ReDoS CVE-2024-22363)이 고쳐지지 않았다. 고친 버전은 SheetJS 공식 CDN으로만 배포된다.
   integrity는 이 URL의 파일 해시다 — 버전을 올리면 해시도 반드시 다시 계산할 것
   (openssl dgst -sha384 -binary xlsx.full.min.js | openssl base64 -A). */
const SHEETJS_SRC='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const SHEETJS_SRI='sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT';
let _sheetJsPromise=null;
function _loadSheetJS(){
  if(window.XLSX)return Promise.resolve(window.XLSX);
  if(_sheetJsPromise)return _sheetJsPromise;
  _sheetJsPromise=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=SHEETJS_SRC;s.integrity=SHEETJS_SRI;s.crossOrigin='anonymous';s.async=true;
    s.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('SheetJS를 불러왔지만 XLSX 전역이 없습니다.'));
    s.onerror=()=>{_sheetJsPromise=null;reject(new Error('엑셀 읽기 라이브러리(SheetJS)를 불러오지 못했습니다 — 네트워크를 확인하고 다시 시도하세요.'));};
    document.head.appendChild(s);
  });
  return _sheetJsPromise;
}
