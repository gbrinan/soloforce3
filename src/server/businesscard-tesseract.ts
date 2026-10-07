// 호스트 tesseract CLI 폴백 — Claude vision 실패 시.
// 명함 이미지 → 텍스트 → 정규식/휴리스틱 파싱 → ContactDraft.
// 호스트에 tesseract 미설치 시 null 반환 (호출자가 502 처리).

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ContactDraft } from "../types.js";

const TESSERACT_TIMEOUT_MS = 30_000;

// 호스트 tesseract 바이너리 위치를 결정 (PATH lookup → 일반 설치 경로 fallback).
function resolveTesseractBin(): string | null {
  const candidates = [
    process.env.TESSERACT_BIN,
    "/opt/homebrew/bin/tesseract",
    "/usr/local/bin/tesseract",
    "/usr/bin/tesseract",
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // PATH 조회
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["tesseract"], { encoding: "utf8" });
  if (which.status === 0) {
    const out = which.stdout.toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (out[0] && existsSync(out[0])) return out[0];
  }
  return null;
}

// 명함 raw 텍스트 → ContactDraft 휴리스틱 파싱.
export function parseBusinessCardText(raw: string): ContactDraft {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRe = /(?:\+?\d{1,3}[\s\-.]?)?(?:\(?0\d{1,2}\)?[\s\-.]?)?\d{3,4}[\s\-.]?\d{4}/g;
  const positionKeywords = /(대표|이사|부장|차장|과장|대리|주임|사원|팀장|실장|본부장|매니저|디렉터|CEO|CTO|CFO|CMO|CDO|CIO|이사회|회장|사장|상무|전무|소장|연구원|책임|선임|수석|엔지니어|개발자|디자이너)/;
  const companyKeywords = /(주식회사|㈜|\(주\)|유한회사|\(유\)|법인|컴퍼니|코퍼레이션|Corp\.?|Inc\.?|LLC|Ltd\.?|Co\.?,?\s?Ltd|Company|Corporation)/i;
  const addressKeywords = /(시|군|구|동|로|길|번지|아파트|타워|빌딩|층|호)\s*\d/;

  const emails: string[] = [];
  const phones: string[] = [];
  let company: string | undefined;
  let department: string | undefined;
  let position: string | undefined;
  let address: string | undefined;
  let name: string | undefined;

  for (const line of lines) {
    const em = line.match(emailRe);
    if (em) emails.push(...em);
    const ph = line.match(phoneRe);
    if (ph) {
      for (const p of ph) {
        const digits = p.replace(/\D/g, "");
        if (digits.length >= 8 && digits.length <= 13) phones.push(p.trim());
      }
    }
  }

  // 회사/주소/직책 한 줄 단위 매칭 (전화·이메일 줄은 제외)
  for (const line of lines) {
    if (line.match(emailRe)) continue;
    if (line.match(phoneRe) && line.replace(/\D/g, "").length >= 8) continue;
    if (!company && companyKeywords.test(line)) company = line;
    if (!position && positionKeywords.test(line)) position = line;
    if (!address && addressKeywords.test(line)) address = line;
  }

  // 이름 휴리스틱: 이메일/전화/회사/직책/주소가 아닌 첫 줄. 한글 2~5자 또는 영문 단어 1~3개.
  for (const line of lines) {
    if (line.match(emailRe)) continue;
    if (line.match(phoneRe) && line.replace(/\D/g, "").length >= 8) continue;
    if (company && line === company) continue;
    if (position && line === position) continue;
    if (address && line === address) continue;
    if (companyKeywords.test(line)) continue;
    if (addressKeywords.test(line)) continue;
    // 한글 이름 패턴: 한글 2~5자 단독
    if (/^[가-힣]{2,5}$/.test(line)) { name = line; break; }
    // 영문 이름 패턴: 단어 1~3개, 각 단어 첫 글자 대문자
    if (/^([A-Z][a-z]+)(\s+[A-Z][a-z]+){0,2}$/.test(line)) { name = line; break; }
    // fallback: 첫 비-주소·비-회사 줄
    if (!name && line.length <= 30) name = line;
  }

  const draft: ContactDraft = {
    name: name || "",
    phone: phones[0],
    phones: phones.length > 1 ? phones : undefined,
    email: emails[0],
    emails: emails.length > 1 ? emails : undefined,
    company,
    department,
    position,
    address,
    source: "photo",
  };
  return draft;
}

export async function extractContactFromImageViaTesseract(imageBuffer: Buffer): Promise<ContactDraft | null> {
  const bin = resolveTesseractBin();
  if (!bin) {
    console.warn("[tesseract] 호스트 tesseract 바이너리 미발견 — 폴백 불가");
    return null;
  }

  const tempPath = join(tmpdir(), `businesscard-tess-${Date.now()}.jpg`);
  try {
    writeFileSync(tempPath, imageBuffer);
  } catch (err) {
    console.warn(`[tesseract] 임시 파일 저장 실패: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  return new Promise((resolve) => {
    const proc = spawn(bin, [tempPath, "stdout", "-l", "kor+eng", "--psm", "6"], {
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
      console.warn("[tesseract] 타임아웃 (30초)");
      resolve(null);
    }, TESSERACT_TIMEOUT_MS);

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      try { unlinkSync(tempPath); } catch {}
      if (code !== 0) {
        console.warn(`[tesseract] exit ${code} stderr: ${stderr.slice(0, 300)}`);
        resolve(null);
        return;
      }
      const text = stdout.trim();
      if (!text) {
        console.warn("[tesseract] 빈 출력");
        resolve(null);
        return;
      }
      const draft = parseBusinessCardText(text);
      if (!draft.name) {
        console.warn(`[tesseract] 이름 추출 실패 — raw len ${text.length}`);
        resolve(null);
        return;
      }
      console.log(`[tesseract] ✅ ${draft.name} (${draft.company || "회사 없음"}) phone=${draft.phone || "-"} email=${draft.email || "-"}`);
      resolve(draft);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      try { unlinkSync(tempPath); } catch {}
      console.warn(`[tesseract] spawn 실패: ${err.message}`);
      resolve(null);
    });
  });
}
