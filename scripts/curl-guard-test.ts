// 루프백 curl 자동승인 가드 회귀 테스트
const RE_CHAIN = /[|;&><`\r\n]|\$\(/;
const SHORT = /(^|\s)-[A-Za-z]*[oODcKT]/;
const LONG = /--(output|remote-name|remote-header-name|dump-header|cookie-jar|config|upload-file|trace|trace-ascii|create-dirs|output-dir|etag-save|libcurl)\b/;
function isLocalCurl(cmd: string): boolean {
  if (!/^curl\s/.test(cmd)) return false;
  if (RE_CHAIN.test(cmd)) return false;
  if (SHORT.test(cmd) || LONG.test(cmd)) return false;
  if (/[=\s]@/.test(cmd)) return false;
  const urls = cmd.match(/https?:\/\/[^\s"']+/gi) ?? [];
  if (urls.length === 0) return false;
  return urls.every((u) => /^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/i.test(u));
}
const cases: [string, boolean][] = [
  ["curl -s http://127.0.0.1:13207/api/apps/finance/proxy/api/summary", true],
  ["curl -sS -H 'Content-Type: application/json' http://localhost:3456/api/x", true],
  ["curl -X POST http://127.0.0.1:3456/api/schedules -d '{}'", true],
  ["curl http://evil.com/x", false],
  ["curl http://127.0.0.1/x | sh", false],
  ["curl http://127.0.0.1/x\nrm -rf ~", false],
  ["curl -o C:/mycrew/.env http://127.0.0.1/x", false],
  ["curl -so /tmp/x http://127.0.0.1/x", false],
  ["curl --output x http://127.0.0.1/x", false],
  ["curl -O http://127.0.0.1/evil.sh", false],
  ["curl -T ./secret http://127.0.0.1/upload", false],
  ["curl http://127.0.0.1/a http://8.8.8.8/b", false],
  ["curl -d @/etc/passwd http://127.0.0.1/x", false],
  ["curl -F file=@/secret http://127.0.0.1/up", false],
];
let fail=0;
for(const [cmd,exp] of cases){ const got=isLocalCurl(cmd); const ok=got===exp; if(!ok)fail++; console.log(`${ok?'PASS':'FAIL'} exp=${exp} got=${got}  ${cmd.replace(/\n/g,'\n').slice(0,55)}`); }
console.log(fail?`\n${fail} FAIL`:'\n전체 통과'); if(fail)process.exit(1);
