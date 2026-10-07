#!/usr/bin/env node
/**
 * Markdown + Mermaid → PDF 변환 스크립트 (올인원)
 * mycrew 이식본 — 원본은 Claude Tower harness의 mermaid-pdf 스킬. Windows Chrome 경로 탐지만 추가.
 *
 * 사용법:
 *   node render_pdf.mjs <input.md> <output.pdf> [options]
 *
 * Options:
 *   --page-size    A4 | Letter | Legal  (기본: A4)
 *   --orientation  portrait | landscape (기본: portrait)
 *   --scale        0.5~2.0              (기본: 1.0)
 *   --margin       top,right,bottom,left in mm (기본: 35,22,35,22)
 *   --html-out     print-ready HTML도 함께 저장
 *   --skip-pdf     HTML만 생성하고 내장 Puppeteer PDF 렌더링은 건너뜀
 */

import puppeteer from 'puppeteer-core';
import { marked } from 'marked';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── OS별 Chrome/Chromium/Edge 경로 자동 감지 ─────────────────────
function findChromePath() {
  const platform = os.platform();
  const candidates = platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
      ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Chrome/Chromium/Edge를 찾을 수 없습니다. 후보 경로:\n${candidates.join('\n')}`);
}

// ─── CLI 인자 파싱 ────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    input: null,
    output: null,
    pageSize: 'A4',
    orientation: 'portrait',
    scale: 1.0,
    margin: { top: 35, right: 22, bottom: 35, left: 22 },
    htmlOut: null,
    skipPdf: false,
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--page-size':
        opts.pageSize = args[++i];
        break;
      case '--orientation':
        opts.orientation = args[++i];
        break;
      case '--scale':
        opts.scale = parseFloat(args[++i]);
        break;
      case '--margin': {
        const parts = args[++i].split(',').map(Number);
        if (parts.length === 4) {
          opts.margin = { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
        } else if (parts.length === 1) {
          opts.margin = { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
        }
        break;
      }
      case '--html-out':
        opts.htmlOut = args[++i];
        break;
      case '--skip-pdf':
        opts.skipPdf = true;
        break;
      default:
        positional.push(args[i]);
    }
  }

  opts.input = positional[0] || null;
  opts.output = positional[1] || null;
  return opts;
}

// ─── 페이지 사이즈 정의 (mm) ──────────────────────────────────────
const PAGE_SIZES = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

// ─── 로컬 이미지 Base64 임베딩 ────────────────────────────────────
function embedLocalImages(mdContent, mdDir) {
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  return mdContent.replace(imgRegex, (match, alt, imgPath) => {
    if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) return match;

    const cleanPath = imgPath.replace(/^\.\//, '');
    const candidates = [
      path.resolve(mdDir, cleanPath),
      path.resolve(cleanPath),
    ];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const data = fs.readFileSync(candidate);
          const ext = path.extname(candidate).slice(1).toLowerCase();
          const mimeMap = {
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
            gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
          };
          const mime = mimeMap[ext] || 'image/png';
          const dataUri = `data:${mime};base64,${data.toString('base64')}`;
          console.log(`  이미지 임베딩: ${cleanPath}`);
          return `![${alt}](${dataUri})`;
        }
      } catch (e) {
        console.warn(`  이미지 임베딩 실패: ${candidate}`, e.message);
      }
    }
    return match;
  });
}

// ─── Markdown → HTML 변환 ─────────────────────────────────────────
function convertMarkdownToHTML(mdContent) {
  const renderer = new marked.Renderer();
  renderer.code = function({ text, lang }) {
    if (lang === 'mermaid') {
      return `<pre class="mermaid">${text}</pre>`;
    }
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<pre><code class="language-${lang || ''}">${escaped}</code></pre>`;
  };

  marked.setOptions({
    renderer,
    gfm: true,
    breaks: false,
  });

  return marked.parse(mdContent);
}

// ─── 전체 HTML 문서 조립 ──────────────────────────────────────────
function buildFullHTML(bodyHTML, opts) {
  const size = PAGE_SIZES[opts.pageSize] || PAGE_SIZES.A4;
  const landscape = opts.orientation === 'landscape';
  const pageW = landscape ? size.height : size.width;
  const pageH = landscape ? size.width : size.height;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <style>
    body {
      font-family: "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.6;
      color: #2e3338;
      /* 주의: padding 사용 금지 — 첫 페이지 상단에만 적용되고 후속 페이지는 0이 됨.
         모든 페이지 마진은 아래 puppeteer page.pdf({margin}) 옵션이 담당한다. */
      padding: 0;
      margin: 0;
    }

    h1, h2, h3, h4, h5, h6 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; }
    h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    h4 { font-size: 1em; }
    p { margin: 16px 0; }

    strong, b { font-weight: 700; }
    em, i { font-style: italic; }
    u { text-decoration: underline; }
    s, del { text-decoration: line-through; }
    mark { background-color: #fff3cd; padding: 0.2em; }

    pre {
      padding: 16px;
      background: #f6f8fa;
      border-radius: 3px;
      overflow-x: auto;
      font-size: 13px;
      line-height: 1.45;
    }
    code {
      background: rgba(27,31,35,0.05);
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      font-size: 0.9em;
    }
    pre code { background: none; padding: 0; font-size: inherit; }

    ul, ol { margin: 16px 0; padding-left: 2em; }
    li { margin: 4px 0; }

    a { color: #0366d6; text-decoration: none; }
    a:hover { text-decoration: underline; }

    blockquote {
      border-left: 4px solid #dfe2e5;
      padding-left: 16px;
      margin: 16px 0;
      color: #6a737d;
    }

    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #dfe2e5; padding: 8px 12px; text-align: left; }
    th { background-color: #f6f8fa; font-weight: 600; }

    img { max-width: 100%; height: auto; }

    hr { border: none; border-top: 1px solid #eaecef; margin: 24px 0; }

    pre.mermaid {
      background: none;
      border: none;
      padding: 0;
      text-align: center;
      margin: 20px 0;
    }
    pre.mermaid svg {
      max-width: 100%;
      height: auto !important;
    }

    /* @page margin은 명시하지 않음 — puppeteer page.pdf({margin})이 유일한 마진 소스. */
    @page {
      size: ${pageW}mm ${pageH}mm;
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      h1, h2, h3, h4, h5, h6 {
        page-break-after: avoid;
        break-after: avoid;
        page-break-inside: avoid;
        break-inside: avoid;
      }

      pre, blockquote, table, img, .mermaid {
        page-break-inside: avoid;
        break-inside: avoid;
      }

      pre.mermaid svg {
        max-height: 50vh !important;
        max-width: 100% !important;
        height: auto !important;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
${bodyHTML}
<script>
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    fontFamily: '"Noto Sans KR", sans-serif',
  });
  mermaid.run({ querySelector: 'pre.mermaid' });
</script>
</body>
</html>`;
}

// ─── Puppeteer PDF 렌더링 ─────────────────────────────────────────
async function renderPDF(htmlContent, pdfPath, opts) {
  const size = PAGE_SIZES[opts.pageSize] || PAGE_SIZES.A4;
  const landscape = opts.orientation === 'landscape';
  const pageW = landscape ? size.height : size.width;
  const pageH = landscape ? size.width : size.height;
  const pxW = Math.round(pageW * 96 / 25.4);
  const pxH = Math.round(pageH * 96 / 25.4);
  const m = opts.margin;

  const tmpDir = os.homedir();
  const tmpHtml = path.resolve(tmpDir, `_tmp_mermaid_${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, htmlContent, 'utf-8');

  const chromePath = findChromePath();
  console.log(`  Chrome 경로: ${chromePath}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: pxW,
      height: pxH,
      deviceScaleFactor: 2,
    });

    console.log('  HTML 로드 중...');
    await page.goto(`file://${tmpHtml}`, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    console.log('  폰트 로딩 대기...');
    await page.evaluateHandle('document.fonts.ready');

    console.log('  Mermaid 렌더링 대기...');
    await page.evaluate(() => {
      return new Promise((resolve) => {
        const check = () => {
          const pres = document.querySelectorAll('pre.mermaid');
          const allRendered = Array.from(pres).every(
            (p) => p.querySelector('svg') || p.getAttribute('data-processed') === 'true'
          );
          if (pres.length === 0 || allRendered) {
            resolve(true);
          } else {
            setTimeout(check, 200);
          }
        };
        setTimeout(check, 500);
        setTimeout(() => resolve(true), 15000);
      });
    });

    await new Promise(r => setTimeout(r, 500));

    const svgCount = await page.$$eval('pre.mermaid svg', els => els.length);
    console.log(`  Mermaid 다이어그램: ${svgCount}개 렌더링됨`);

    console.log('  PDF 렌더링 중...');
    const pdfBuffer = await page.pdf({
      width: `${pageW}mm`,
      height: `${pageH}mm`,
      printBackground: true,
      scale: opts.scale,
      margin: {
        top: `${m.top}mm`,
        right: `${m.right}mm`,
        bottom: `${m.bottom}mm`,
        left: `${m.left}mm`,
      },
    });

    fs.writeFileSync(path.resolve(pdfPath), pdfBuffer);
    console.log(`  PDF 저장 완료: ${path.resolve(pdfPath)}`);

  } finally {
    await browser.close();
    try { fs.unlinkSync(tmpHtml); } catch {}
  }
}

// ─── Main ─────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.input || !opts.output) {
    console.log(`사용법: node render_pdf.mjs <input.md> <output.pdf> [options]

Options:
  --page-size    A4 | Letter | Legal  (기본: A4)
  --orientation  portrait | landscape (기본: portrait)
  --scale        0.5~2.0              (기본: 1.0)
  --margin       top,right,bottom,left in mm (기본: 35,22,35,22)
  --html-out     print-ready HTML도 함께 저장
  --skip-pdf     HTML만 생성하고 내장 Puppeteer PDF 렌더링은 건너뜀`);
    process.exit(1);
  }

  const inputPath = path.resolve(opts.input);
  const outputPath = path.resolve(opts.output);

  if (!fs.existsSync(inputPath)) {
    console.error(`파일을 찾을 수 없습니다: ${inputPath}`);
    process.exit(1);
  }

  console.log(`─── Mermaid PDF 변환 ───`);
  console.log(`입력: ${inputPath}`);
  console.log(`출력: ${outputPath}`);
  console.log(`페이지: ${opts.pageSize} ${opts.orientation}`);
  console.log(`스케일: ${opts.scale}`);
  console.log(`마진: ${opts.margin.top},${opts.margin.right},${opts.margin.bottom},${opts.margin.left} mm`);
  console.log();

  console.log('[1/4] Markdown 읽기...');
  let mdContent = fs.readFileSync(inputPath, 'utf-8');

  if (mdContent.startsWith('---')) {
    const endIdx = mdContent.indexOf('---', 3);
    if (endIdx !== -1) {
      mdContent = mdContent.slice(endIdx + 3).trim();
    }
  }

  console.log('[2/4] 이미지 임베딩...');
  const mdDir = path.dirname(inputPath);
  mdContent = embedLocalImages(mdContent, mdDir);

  console.log('[3/4] Markdown → HTML 변환...');
  const bodyHTML = convertMarkdownToHTML(mdContent);
  const fullHTML = buildFullHTML(bodyHTML, opts);

  if (opts.htmlOut) {
    const htmlOutPath = path.resolve(opts.htmlOut);
    fs.mkdirSync(path.dirname(htmlOutPath), { recursive: true });
    fs.writeFileSync(htmlOutPath, fullHTML, 'utf-8');
    console.log(`  HTML 저장 완료: ${htmlOutPath}`);
  }

  if (opts.skipPdf) {
    console.log();
    console.log(`완료! HTML 생성: ${opts.htmlOut ? path.resolve(opts.htmlOut) : '(html-out 미지정)'}`);
    return;
  }

  console.log('[4/4] PDF 렌더링...');
  await renderPDF(fullHTML, outputPath, opts);

  console.log();
  console.log(`완료! ${outputPath}`);
}

main().catch(err => {
  console.error('오류:', err);
  process.exit(1);
});
