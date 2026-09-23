/*
  build.js - 로컬 index.html -> 배포용 dist/index.html

  아티팩트는 <!doctype>/<html>/<head>/<body> 를 게시 시점에 직접 감싸주므로
  본문만 남겨야 하고, 외부 스크립트는 허용된 CDN에서만 로드할 수 있다.
  로컬 원본은 오프라인 실행을 위해 lib/three.min.js 를 쓰지만
  배포본은 lib/ 를 올리지 않으므로 jsdelivr(npm) 경로로 교체한다.

  사용법:  node build.js
*/

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'index.html');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_DIR, 'index.html');

const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js';

let html = fs.readFileSync(SRC, 'utf8');

// 1) 래퍼 태그 제거
html = html
  .replace(/<!DOCTYPE html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*$/i, '')
  .replace(/<head>\s*/i, '')
  .replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*/i, '');

// 2) 스켈레톤이 이미 넣어주는 meta 제거
html = html
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

// 3) three.js 로더를 CDN 단일 태그로 교체
html = html.replace(
  /<!-- 로컬 사본이[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/,
  '<script src="' + THREE_CDN + '"></script>'
);

if (html.indexOf(THREE_CDN) === -1) {
  console.error('[build] three.js 로더 교체 실패 — index.html 의 스크립트 블록을 확인하세요.');
  process.exit(1);
}
if (/<body|<head|<!DOCTYPE/i.test(html)) {
  console.error('[build] 래퍼 태그가 남아 있습니다.');
  process.exit(1);
}

// 4) 다크 전용 페이지임을 명시
html = html.replace(/:root\{/, ':root{\n    color-scheme:dark;');

html = html.trimStart();

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');

console.log('[build] dist/index.html 생성 완료 (' + Math.round(html.length / 1024) + ' KB)');
