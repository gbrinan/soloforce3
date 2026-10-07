/**
 * Barocert 전자서명/본인인증 서비스 타입 정의
 *
 * Barocert는 카카오, 네이버, 토스 인증서를 통한
 * 본인인증 및 전자서명 서비스를 제공합니다.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Barocert 클라이언트 설정 */
export interface BarocertConfig {
  /** Linkhub에서 발급받은 링크 아이디 */
  linkID: string;
  /** Linkhub에서 발급받은 비밀키 (Base64) */
  secretKey: string;
  /** 이용기관 코드 */
  clientCode: string;
  /** API 기본 URL (기본값: https://barocert.linkhub.co.kr) */
  baseUrl?: string;
  /** Linkhub 토큰 API URL (기본값: https://auth.linkhub.co.kr) */
  authUrl?: string;
  /** 요청 타임아웃 (ms, 기본값: 30000) */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// 인증 공급자
// ---------------------------------------------------------------------------

/** 인증서 공급자 */
export type CertProvider = 'kakao' | 'naver' | 'toss';

// ---------------------------------------------------------------------------
// Linkhub 토큰
// ---------------------------------------------------------------------------

/** Linkhub 인증 토큰 응답 */
export interface LinkhubToken {
  session_token: string;
  serviceID: string;
  linkID: string;
  usercode: string;
  expiration: string;
}

// ---------------------------------------------------------------------------
// 본인인증 (Identity Verification)
// ---------------------------------------------------------------------------

/** 본인인증 요청 파라미터 */
export interface IdentityVerificationRequest {
  /** 수신자 휴대폰번호 (하이픈 없이, 예: 01012345678) */
  receiverHP: string;
  /** 수신자 성명 */
  receiverName: string;
  /** 수신자 생년월일 (YYYYMMDD) */
  receiverBirthday: string;
  /** 인증 요청 메시지 (선택) */
  reqTitle?: string;
  /** 인증 만료 시간 (초, 기본값: 300) */
  expireIn?: number;
  /** 앱 사용 여부 */
  appUseYN?: boolean;
  /** 요청 고유번호 (중복 방지, 선택) */
  requestID?: string;
}

/** 본인인증 요청 응답 */
export interface IdentityVerificationResponse {
  /** 접수 아이디 */
  receiptID: string;
  /** 인증서 공급자별 고유 코드 */
  scheme: string;
}

/** 본인인증 상태 조회 응답 */
export interface IdentityVerificationStatus {
  /** 접수 아이디 */
  receiptID: string;
  /** 이용기관 코드 */
  clientCode: string;
  /**
   * 상태코드
   * 0: 대기, 1: 완료, 2: 만료, 3: 거부, 4: 실패
   */
  state: number;
  /** 만료 시각 (ISO 8601) */
  expireIn: string;
  /** 요청 고유번호 */
  requestID?: string;
}

/** 본인인증 결과 확인 응답 */
export interface IdentityVerificationResult {
  /** 접수 아이디 */
  receiptID: string;
  /**
   * 상태코드
   * 0: 대기, 1: 완료, 2: 만료, 3: 거부, 4: 실패
   */
  state: number;
  /** 수신자 이름 (서명 완료 시) */
  receiverName?: string;
  /** 수신자 휴대폰번호 (서명 완료 시) */
  receiverHP?: string;
  /** 수신자 생년월일 (서명 완료 시) */
  receiverBirthday?: string;
  /** CI 값 */
  ci?: string;
  /** DI 값 */
  di?: string;
  /** 서명 데이터 */
  signedData?: string;
}

// ---------------------------------------------------------------------------
// 전자서명 (Digital Signature)
// ---------------------------------------------------------------------------

/** 전자서명 요청 파라미터 */
export interface SignRequest {
  /** 수신자 휴대폰번호 (하이픈 없이) */
  receiverHP: string;
  /** 수신자 성명 */
  receiverName: string;
  /** 수신자 생년월일 (YYYYMMDD) */
  receiverBirthday: string;
  /** 서명할 원문 (Base64 인코딩) */
  token: string;
  /** 서명 요청 제목 */
  reqTitle?: string;
  /** 서명 요청 메시지 */
  reqMessage?: string;
  /** 인증 만료 시간 (초, 기본값: 300) */
  expireIn?: number;
  /** 토큰 타입 (TEXT / HASH) */
  tokenType?: 'TEXT' | 'HASH';
  /** 앱 사용 여부 */
  appUseYN?: boolean;
  /** 요청 고유번호 (중복 방지, 선택) */
  requestID?: string;
}

/** 전자서명 요청 응답 */
export interface SignResponse {
  /** 접수 아이디 */
  receiptID: string;
  /** 인증서 공급자별 고유 코드 */
  scheme: string;
}

/** 전자서명 상태 조회 응답 */
export interface SignStatus {
  /** 접수 아이디 */
  receiptID: string;
  /** 이용기관 코드 */
  clientCode: string;
  /**
   * 상태코드
   * 0: 대기, 1: 완료, 2: 만료, 3: 거부, 4: 실패
   */
  state: number;
  /** 만료 시각 (ISO 8601) */
  expireIn: string;
  /** 요청 고유번호 */
  requestID?: string;
}

/** 전자서명 결과 확인 응답 */
export interface SignResult {
  /** 접수 아이디 */
  receiptID: string;
  /**
   * 상태코드
   * 0: 대기, 1: 완료, 2: 만료, 3: 거부, 4: 실패
   */
  state: number;
  /** 수신자 이름 (서명 완료 시) */
  receiverName?: string;
  /** 수신자 휴대폰번호 (서명 완료 시) */
  receiverHP?: string;
  /** 서명 데이터 (서명 완료 시) */
  signedData?: string;
  /** CI 값 */
  ci?: string;
  /** 요청 고유번호 */
  requestID?: string;
}

// ---------------------------------------------------------------------------
// 에러
// ---------------------------------------------------------------------------

/** Barocert API 에러 응답 */
export interface BarocertErrorResponse {
  code: number;
  message: string;
}

// ---------------------------------------------------------------------------
// API Route 요청/응답
// ---------------------------------------------------------------------------

/** API 라우트 요청 바디 (POST /api/barocert) */
export interface BarocertApiRequest {
  /** 인증서 공급자 */
  provider: CertProvider;
  /** 요청 유형 */
  type: 'identity' | 'sign';
  /** 수신자 정보 */
  receiverInfo: {
    receiverHP: string;
    receiverName: string;
    receiverBirthday: string;
  };
  /** 전자서명 시 서명할 원문 (Base64) */
  token?: string;
  /** 요청 제목 */
  reqTitle?: string;
  /** 요청 메시지 */
  reqMessage?: string;
}

/** API 라우트 상태 조회 쿼리 (GET /api/barocert) */
export interface BarocertApiStatusQuery {
  /** 접수 아이디 */
  receiptId: string;
  /** 인증서 공급자 */
  provider: CertProvider;
  /** 요청 유형 */
  type: 'identity' | 'sign';
  /** 결과 확인 여부 (true면 verify까지 수행) */
  verify?: string;
}
