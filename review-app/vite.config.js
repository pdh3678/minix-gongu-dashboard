import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// index.html/dashboard.html은 정적 파일이라 매 배포마다 해시된 파일명을 새로 참조하도록
// 고칠 수 없음 — 그래서 파일명을 고정하고(review.js/review.css) 코드 스플리팅 없는 단일
// IIFE 번들로 출력. 정적 사이트 루트(..)의 review-assets/ 아래에 직접 씀.
export default defineConfig({
  plugins: [react()],
  // lib 모드(iife)는 앱 빌드와 달리 process.env.NODE_ENV를 자동으로 치환하지 않음 —
  // React가 내부에서 이 값을 직접 참조해 미치환 시 브라우저에서 "process is not defined"로 죽음.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: '../review-assets',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/main.jsx',
      name: 'ReviewApp',
      formats: ['iife'],
      fileName: () => 'review.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'review.[ext]',
      },
    },
  },
});
