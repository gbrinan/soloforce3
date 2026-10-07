# 문서 산출물 생성 가이드 (Word/Excel/PPT)

자비스 직원이 .docx / .xlsx / .pptx 파일을 만들 때 참고하는 가이드.

## 어떤 라이브러리를 언제 쓰나

| 포맷 | 라이브러리 | 버전 | 쓰는 상황 |
|------|-----------|------|-----------|
| `.docx` (Word) | `docx` | ^9.x | 보고서 본문, 회의록, 제안서 — 단락/표 위주 |
| `.xlsx` (Excel) | `exceljs` | ^4.4 | 매출/회계 표, 데이터 집계, 다중 시트 |
| `.pptx` (PowerPoint) | `pptxgenjs` | ^4.0 | 발표자료, 슬라이드 정리 |

모두 순수 Node.js (네이티브 의존 X) → tsx로 즉시 실행 가능.

## 출력 경로 컨벤션

- **개인 산출물**: `history/outputs/<직원id>/<파일명>_<직원id>_<YYYY-MM-DD>.<ext>`
  - 예: `history/outputs/dev-pm/매출보고_dev-pm_2026-05-18.xlsx`
- **첨부 (날짜 폴더)**: `history/attachments/<YYYY-MM-DD>/<파일명>.<ext>`
  - 친구에게 전송하거나 inbox 첨부로 쓰는 경우
- `history/`는 `.gitignore`로 자동 제외 → 안전하게 큰 파일도 OK
- 임시 검증은 `tmp/<파일명>.<ext>` (dev-pm은 `/tmp/**` write 권한 보유)

## 최소 동작 스니펫

### Word (.docx)
```ts
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { writeFile } from 'node:fs/promises';

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({ text: '제목', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun('본문 한 줄')] }),
    ],
  }],
});
const buf = await Packer.toBuffer(doc);
await writeFile('history/outputs/dev-pm/report_dev-pm_2026-05-18.docx', buf);
```

### Excel (.xlsx)
```ts
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('매출');
ws.columns = [
  { header: '이름', key: 'name', width: 12 },
  { header: '매출', key: 'amount', width: 14 },
  { header: '날짜', key: 'date', width: 14 },
];
ws.addRows([
  { name: '가나다', amount: 100000, date: '2026-05-18' },
]);
await wb.xlsx.writeFile('history/outputs/dev-pm/sales_dev-pm_2026-05-18.xlsx');
```

### PowerPoint (.pptx)
```ts
import PptxGenJS from 'pptxgenjs';

const pres = new PptxGenJS();
const slide = pres.addSlide();
slide.addText('제목 슬라이드', { x: 0.5, y: 1.0, w: 9, h: 1, fontSize: 36, bold: true });
slide.addText('부제목/메모', { x: 0.5, y: 2.2, w: 9, h: 0.6, fontSize: 18, color: '666666' });
await pres.writeFile({ fileName: 'history/outputs/dev-pm/intro_dev-pm_2026-05-18.pptx' });
```

## {{USER}}이 파일 받는 방법

1. **대시보드 산출물 탭**: `history/outputs/<직원id>/` 하위 파일이 자동 노출 → 클릭으로 다운로드
2. **친구에게 전송**: `history/attachments/<날짜>/` 에 저장 후 inbox 메시지 첨부로 전송
3. **경로 안내**: 직원이 채팅 응답에서 `history/outputs/dev-pm/foo.xlsx` 경로를 명시 → {{USER}}이 직접 열기

## 자주 하는 실수

- `pres.write({ outputType: 'nodebuffer' })`로 Buffer만 받고 `writeFile`은 잊는 케이스 — `pres.writeFile({ fileName })` 한 줄이면 끝.
- ExcelJS 셀에 객체/Date 그대로 넣으면 깨질 수 있음 → string/number/Date 명확히.
- docx의 `Packer.toBuffer`는 Promise — `await` 필수.
- 파일명에 한글 OK (한글 파일명도 정상 저장됨).

## 검증

설치 직후 동작 확인은 `tmp/`에 샘플 3개 생성하여 `wc -c`로 0바이트 아님을 보장. 본 가이드는 2026-05-18에 docx/exceljs/pptxgenjs로 검증됨.
