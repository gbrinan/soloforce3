// 외부 inbound 메시지 분류 (자동 vs 승인 필요 vs ambiguous).
// 기획서 §5-1 매트릭스 기반. partner.scope 검증 포함.
// 보안 원칙: 분류는 백엔드가 결정 (마이크루에게 위임 X). 마이크루는 응답 작성만 담당.

import type {
  ExternalMessage,
  ExternalMessageClassification,
  ExternalHandlingMode,
  ExternalMessageType,
  Partner,
} from "../types.js";

interface ClassifyInput {
  body: string;
  messageType?: ExternalMessageType;
  partner: Partner;
  injectionFlagsCount: number;
}

export interface ClassifyResult {
  classification: ExternalMessageClassification;
  handlingMode: ExternalHandlingMode;
  reason: string;
}

// 키워드 사전 — 한국어 우선, 영어 보조
const FINANCIAL_KW = ["결제", "송금", "계약", "단가", "견적", "payment", "invoice", "contract", "billing"];
const DELEGATION_KW = ["부탁", "써주세요", "써 주세요", "만들어주세요", "만들어 주세요", "작성해주세요", "작성해 주세요", "해주세요", "해 주세요", "request", "please draft", "please create"];
const DELEGATION_NOUN_KW = ["보고서", "시안", "초안", "디자인", "제안서", "코드", "스크립트", "report", "draft", "proposal"];
const DATA_SHARE_KW = ["첨부", "데이터", "파일", "산출물", "내부 자료", "attach", "file", "document", "spreadsheet"];
const INFO_KW = ["알려주세요", "알려 주세요", "조사", "확인", "어때요", "어떤가요", "tell me", "let me know"];
const SIMPLE_QUESTION_KW = ["가능한가요", "가능해요", "되나요", "있나요", "있어요", "어떻게", "available", "possible"];

function containsAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

export function classifyMessage(input: ClassifyInput): ClassifyResult {
  const { body, messageType, partner, injectionFlagsCount } = input;

  // 1. messageType이 명시된 경우 우선 처리
  if (messageType === "token_update") {
    return {
      classification: "token_update",
      handlingMode: "approval_required",
      reason: "messageType=token_update — 신뢰 boundary 변경, 담당자 승인 필요",
    };
  }
  if (messageType === "reply") {
    // reply는 자동 분류 없이 인박스에만 저장 (응답 루프 방지)
    return { classification: "info", handlingMode: "auto", reason: "messageType=reply (자동 응답 X)" };
  }
  if (messageType === "notification") {
    return { classification: "info", handlingMode: "auto", reason: "messageType=notification" };
  }

  // 2. injection 의심 시 ambiguous로 강등 (자동 처리 차단)
  if (injectionFlagsCount > 0) {
    return {
      classification: "ambiguous",
      handlingMode: "asked_owner",
      reason: `injection 패턴 ${injectionFlagsCount}건 감지 — 담당자 확인`,
    };
  }

  // 3. financial → 항상 승인 (강제)
  if (containsAny(body, FINANCIAL_KW)) {
    return {
      classification: "financial",
      handlingMode: "approval_required",
      reason: "금전·계약 키워드",
    };
  }

  // 4. delegation 판정 (부탁/요청 동사 + 산출물 명사 동시 매칭)
  const hasDelegationVerb = containsAny(body, DELEGATION_KW);
  const hasDelegationNoun = containsAny(body, DELEGATION_NOUN_KW);
  if (hasDelegationVerb && hasDelegationNoun) {
    if (partner.scope?.canDelegate) {
      return {
        classification: "delegation",
        handlingMode: "approval_required",
        reason: "작업 위임 — scope.canDelegate=true이지만 MVP는 항상 승인",
      };
    }
    return {
      classification: "delegation",
      handlingMode: "approval_required",
      reason: "작업 위임 — scope.canDelegate=false",
    };
  }

  // 5. data_share — 첨부/내부 데이터 송신 키워드
  if (containsAny(body, DATA_SHARE_KW)) {
    if (partner.scope?.canAccessFiles) {
      return {
        classification: "info_with_files",
        handlingMode: "auto",
        reason: "자료 공유 — scope.canAccessFiles=true",
      };
    }
    return {
      classification: "data_share",
      handlingMode: "approval_required",
      reason: "자료 공유 — scope.canAccessFiles=false",
    };
  }

  // 6. simple_answer — 단답형 질문
  if (containsAny(body, SIMPLE_QUESTION_KW)) {
    return {
      classification: "simple_answer",
      handlingMode: "auto",
      reason: "단순 질문",
    };
  }

  // 7. info — 정보 조회·공유
  if (containsAny(body, INFO_KW)) {
    return {
      classification: "info",
      handlingMode: "auto",
      reason: "정보 조회",
    };
  }

  // 8. 키워드 어느 쪽도 강하지 않음 → ambiguous
  return {
    classification: "ambiguous",
    handlingMode: "asked_owner",
    reason: "분류 키워드 없음 — 담당자 확인",
  };
}
