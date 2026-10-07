// Claude CLI를 사용한 명함 이미지 → 연락처 정보 추출.
// OCR 폴백 전 우선 시도. 실패 시 null 반환 → OCR 경로로.

import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ContactDraft } from "../types.js";

const CLAUDE_TIMEOUT_MS = 30_000;

export async function extractContactFromImageViaClaude(imageBuffer: Buffer): Promise<ContactDraft | null> {
  const tempPath = join(tmpdir(), `businesscard-${Date.now()}.jpg`);
  try {
    writeFileSync(tempPath, imageBuffer);

    const prompt = `명함 이미지에서 연락처 정보를 JSON 형식으로 추출하세요.

응답 형식:
{
  "name": "이름",
  "phone": "전화번호",
  "email": "이메일",
  "company": "회사명",
  "department": "부서",
  "position": "직책",
  "address": "주소"
}

없는 필드는 생략하세요. JSON만 출력하세요.`;

    return new Promise((resolve) => {
      // Claude CLI 호출 시도 — -f 플래그로 이미지 파일 첨부.
      // vision 모델 명시로 이미지 분석 지원 보장.
      const proc = spawn("claude", ["-p", prompt, "-f", tempPath, "--model", "claude-sonnet-4-6"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGTERM");
        try { unlinkSync(tempPath); } catch {}
        console.warn("[Claude vision] 타임아웃 (30초) — 부분 출력:", stdout.slice(0, 200));
        resolve(null);
      }, CLAUDE_TIMEOUT_MS);

      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        try { unlinkSync(tempPath); } catch {}

        if (code !== 0) {
          console.warn(`[Claude vision] exit ${code}`);
          console.warn(`  stderr: ${stderr.slice(0, 300)}`);
          console.warn(`  stdout: ${stdout.slice(0, 300)}`);
          console.warn(`  → OCR 폴백으로 진행합니다.`);
          resolve(null);
          return;
        }

        try {
          // JSON 추출 (markdown 코드 블록 제거)
          let text = stdout.trim();
          const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
          if (jsonMatch) text = jsonMatch[1].trim();

          const parsed = JSON.parse(text);

          // ContactDraft로 변환
          const draft: ContactDraft = {
            name: parsed.name || "",
            phone: parsed.phone,
            email: parsed.email,
            company: parsed.company,
            department: parsed.department,
            position: parsed.position,
            address: parsed.address,
            source: "photo",
          };

          if (!draft.name) {
            console.warn("[Claude vision] name 필드 누락");
            resolve(null);
            return;
          }

          console.log(`[Claude vision] ✅ 성공: ${draft.name} (${draft.company || "회사 없음"})`);
          console.log(`  전화: ${draft.phone || "없음"}, 이메일: ${draft.email || "없음"}`);
          resolve(draft);
        } catch (err) {
          console.warn(`[Claude vision] JSON 파싱 실패: ${err instanceof Error ? err.message : err}`);
          console.warn(`  원본 출력: ${stdout.slice(0, 500)}`);
          resolve(null);
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        try { unlinkSync(tempPath); } catch {}
        console.warn(`[Claude vision] spawn 실패: ${err.message}`);
        resolve(null);
      });
    });
  } catch (err) {
    try { unlinkSync(tempPath); } catch {}
    console.warn(`[Claude vision] 파일 저장 실패: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// Claude vision 실패 시 폴백 — 호스트 tesseract(kor+eng)로 명함 이미지 OCR 후 필드 파싱.
const TESSERACT_BIN = "/opt/homebrew/bin/tesseract";
const TESSERACT_TIMEOUT_MS = 30_000;

export async function extractContactFromImageViaTesseract(imageBuffer: Buffer): Promise<ContactDraft | null> {
  const tempPath = join(tmpdir(), `businesscard-tess-${Date.now()}.jpg`);
  try {
    writeFileSync(tempPath, imageBuffer);
    const rawText = await runTesseract(tempPath);
    try { unlinkSync(tempPath); } catch {}
    if (!rawText) return null;
    const draft = parseContactFromText(rawText);
    if (draft) {
      console.log(`[tesseract] ✅ 폴백 추출: ${draft.name} (${draft.company || "회사 없음"})`);
    } else {
      console.warn("[tesseract] 파싱 결과 없음 (name 미검출)");
    }
    return draft;
  } catch (err) {
    try { unlinkSync(tempPath); } catch {}
    console.warn(`[tesseract] 실행 실패: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function runTesseract(imagePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(TESSERACT_BIN, [imagePath, "stdout", "-l", "kor+eng"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      console.warn("[tesseract] 타임아웃 (30초)");
      resolve(null);
    }, TESSERACT_TIMEOUT_MS);

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        console.warn(`[tesseract] exit ${code}: ${stderr.slice(0, 200)}`);
        resolve(null);
        return;
      }
      resolve(stdout);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      console.warn(`[tesseract] spawn 실패: ${err.message}`);
      resolve(null);
    });
  });
}

function parseContactFromText(raw: string): ContactDraft | null {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const text = lines.join("\n");

  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  const phone = text.match(/(?:\+?82[-.\s]?)?0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/)?.[0];

  const positionKeywords = /(대표이사|대표|부사장|사장|이사|부장|차장|과장|대리|팀장|실장|주임|사원|매니저|연구원|책임|선임|수석|CEO|CTO|CFO|COO|Manager|Director|President|Engineer)/i;
  const companyKeywords = /(주식회사|㈜|\(주\)|유한회사|Inc\.?|Corp\.?|Ltd\.?|Co\.?,?\s*Ltd|Company|Group|Labs?|Tech)/i;
  const addressKeywords = /(서울|경기|인천|부산|대구|대전|광주|울산|세종|강원|충청|전라|경상|제주)/;

  let company: string | undefined;
  let position: string | undefined;
  let address: string | undefined;
  let name: string | undefined;

  for (const line of lines) {
    if (!company && companyKeywords.test(line)) company = line;
    if (!position && positionKeywords.test(line)) position = line;
    if (!address && addressKeywords.test(line) && /\d/.test(line)) address = line;
  }

  for (const line of lines) {
    if (line === company || line === position || line === address) continue;
    if (/@|\d{3,}/.test(line)) continue;
    const hangulName = line.match(/^[가-힣]{2,5}$/);
    if (hangulName) { name = hangulName[0]; break; }
  }
  if (!name) {
    for (const line of lines) {
      if (/@|\d{3,}/.test(line)) continue;
      if (companyKeywords.test(line) || positionKeywords.test(line)) continue;
      if (/^[A-Za-z]+(?:\s+[A-Za-z]+){1,2}$/.test(line)) { name = line; break; }
    }
  }
  if (!name) name = lines[0];
  if (!name) return null;

  return { name, phone, email, company, position, address, source: "photo" };
}
