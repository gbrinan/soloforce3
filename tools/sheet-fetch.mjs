#!/usr/bin/env node
// 구글 스프레드시트 CSV 가져오기 (키 불필요, "링크가 있는 모든 사용자" 공유 필요). [로컬 패치 2026-07-15]
// 사용법: node tools/sheet-fetch.mjs "<시트 URL>" [gid]
// 출력: CSV 텍스트 (stdout)
const urlArg = process.argv[2];
if (!urlArg) {
  console.error('usage: node tools/sheet-fetch.mjs "<google sheet url>" [gid]');
  process.exit(1);
}
const idMatch = urlArg.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
if (!idMatch) {
  console.error("시트 URL에서 문서 id를 찾지 못했습니다: " + urlArg);
  process.exit(1);
}
const gidMatch = urlArg.match(/[#&?]gid=(\d+)/);
const gid = process.argv[3] ?? gidMatch?.[1] ?? "0";
const exportUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gid}`;

try {
  const res = await fetch(exportUrl, { redirect: "follow" });
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith("<!DOCTYPE") || text.includes("<html")) {
    console.error(
      `시트를 CSV로 가져오지 못했습니다 (status ${res.status}). ` +
      "시트 공유 설정이 '링크가 있는 모든 사용자(뷰어)'인지 확인하세요.",
    );
    process.exit(2);
  }
  console.log(text);
} catch (err) {
  console.error(`요청 실패: ${err?.message ?? err}`);
  process.exit(3);
}
