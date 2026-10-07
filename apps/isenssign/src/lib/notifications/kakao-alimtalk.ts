/**
 * Kakao Alimtalk (카카오 알림톡) 클라이언트
 *
 * 카카오 비즈니스 채널 API를 통해 사전 등록된 메시지 템플릿으로
 * 서명 요청, 완료, 리마인더, 본인인증 등의 알림을 발송합니다.
 *
 * 필요한 환경변수:
 * - KAKAO_ALIMTALK_API_KEY: 카카오 비즈메시지 API 키
 * - KAKAO_ALIMTALK_SENDER_KEY: 발신 프로필 키
 * - KAKAO_ALIMTALK_API_URL: API URL (기본값: https://bizapi.kakao.com)
 *
 * @example
 * ```ts
 * const alimtalk = new KakaoAlimtalkClient();
 * await alimtalk.sendSigningRequest(
 *   '01012345678', '홍길동', '근로계약서', 'https://sign.example.com/abc',
 * );
 * ```
 */

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

/** 알림톡 발송 설정 */
export interface KakaoAlimtalkConfig {
  /** 카카오 비즈메시지 API 키 */
  apiKey: string;
  /** 발신 프로필 키 (카카오톡 채널) */
  senderKey: string;
  /** API 기본 URL */
  apiUrl?: string;
  /** 요청 타임아웃 (ms) */
  timeout?: number;
}

/** 메시지 템플릿 코드 */
export type AlimtalkTemplateCode =
  | 'SIGNING_REQUEST'
  | 'SIGNING_COMPLETE'
  | 'SIGNING_REMINDER'
  | 'VERIFICATION_REQUEST';

/** 템플릿 변수 */
export interface TemplateVariables {
  signerName?: string;
  documentName?: string;
  signingUrl?: string;
  [key: string]: string | undefined;
}

/** 알림톡 발송 요청 */
interface AlimtalkSendRequest {
  senderKey: string;
  templateCode: string;
  recipientList: Array<{
    recipientNo: string;
    templateParameter: Record<string, string>;
    buttons?: Array<{
      type: string;
      name: string;
      linkMobile?: string;
      linkPc?: string;
    }>;
  }>;
}

/** 알림톡 발송 응답 */
export interface AlimtalkSendResponse {
  /** 요청 ID */
  requestId: string;
  /** 성공 여부 */
  success: boolean;
  /** 에러 메시지 (실패 시) */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// 에러
// ---------------------------------------------------------------------------

export class AlimtalkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AlimtalkError';
  }
}

// ---------------------------------------------------------------------------
// 클라이언트
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = 'https://bizapi.kakao.com';
const DEFAULT_TIMEOUT = 10_000;

/**
 * 사전 등록된 템플릿 코드 매핑.
 * 카카오 비즈메시지 관리자에서 등록한 템플릿 코드와 일치해야 합니다.
 */
const TEMPLATE_CODES: Record<AlimtalkTemplateCode, string> = {
  SIGNING_REQUEST: 'ISENS_SIGN_REQ',
  SIGNING_COMPLETE: 'ISENS_SIGN_DONE',
  SIGNING_REMINDER: 'ISENS_SIGN_REMIND',
  VERIFICATION_REQUEST: 'ISENS_VERIFY_REQ',
};

export class KakaoAlimtalkClient {
  private readonly apiKey: string;
  private readonly senderKey: string;
  private readonly apiUrl: string;
  private readonly timeout: number;

  constructor(config?: Partial<KakaoAlimtalkConfig>) {
    this.apiKey = config?.apiKey ?? process.env.KAKAO_ALIMTALK_API_KEY ?? '';
    this.senderKey = config?.senderKey ?? process.env.KAKAO_ALIMTALK_SENDER_KEY ?? '';
    this.apiUrl = (config?.apiUrl ?? process.env.KAKAO_ALIMTALK_API_URL ?? DEFAULT_API_URL)
      .replace(/\/+$/, '');
    this.timeout = config?.timeout ?? DEFAULT_TIMEOUT;

    if (!this.apiKey || !this.senderKey) {
      throw new AlimtalkError(
        'CONFIG_ERROR',
        'KAKAO_ALIMTALK_API_KEY, KAKAO_ALIMTALK_SENDER_KEY 환경변수가 필요합니다.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // 공개 메서드
  // -------------------------------------------------------------------------

  /**
   * 서명 요청 알림톡을 발송합니다.
   *
   * 템플릿 변수: #{signerName}, #{documentName}, #{signingUrl}
   *
   * @param phone - 수신자 휴대폰번호 (하이픈 없이)
   * @param signerName - 서명자 이름
   * @param documentName - 문서 이름
   * @param signingUrl - 서명 페이지 URL
   */
  async sendSigningRequest(
    phone: string,
    signerName: string,
    documentName: string,
    signingUrl: string,
  ): Promise<AlimtalkSendResponse> {
    this.validatePhone(phone);

    return this.send('SIGNING_REQUEST', phone, {
      signerName,
      documentName,
      signingUrl,
    }, [
      {
        type: 'WL',
        name: '서명하기',
        linkMobile: signingUrl,
        linkPc: signingUrl,
      },
    ]);
  }

  /**
   * 서명 완료 알림톡을 발송합니다.
   *
   * 템플릿 변수: #{signerName}, #{documentName}
   *
   * @param phone - 수신자 휴대폰번호 (하이픈 없이)
   * @param signerName - 서명자 이름
   * @param documentName - 문서 이름
   */
  async sendSigningComplete(
    phone: string,
    signerName: string,
    documentName: string,
  ): Promise<AlimtalkSendResponse> {
    this.validatePhone(phone);

    return this.send('SIGNING_COMPLETE', phone, {
      signerName,
      documentName,
    });
  }

  /**
   * 서명 리마인더 알림톡을 발송합니다.
   *
   * 템플릿 변수: #{signerName}, #{documentName}, #{signingUrl}
   *
   * @param phone - 수신자 휴대폰번호 (하이픈 없이)
   * @param signerName - 서명자 이름
   * @param documentName - 문서 이름
   * @param signingUrl - 서명 페이지 URL
   */
  async sendSigningReminder(
    phone: string,
    signerName: string,
    documentName: string,
    signingUrl: string,
  ): Promise<AlimtalkSendResponse> {
    this.validatePhone(phone);

    return this.send('SIGNING_REMINDER', phone, {
      signerName,
      documentName,
      signingUrl,
    }, [
      {
        type: 'WL',
        name: '서명하기',
        linkMobile: signingUrl,
        linkPc: signingUrl,
      },
    ]);
  }

  /**
   * 본인인증 요청 알림톡을 발송합니다.
   *
   * 템플릿 변수: #{signerName}
   *
   * @param phone - 수신자 휴대폰번호 (하이픈 없이)
   * @param signerName - 서명자 이름
   */
  async sendVerificationRequest(
    phone: string,
    signerName: string,
  ): Promise<AlimtalkSendResponse> {
    this.validatePhone(phone);

    return this.send('VERIFICATION_REQUEST', phone, {
      signerName,
    });
  }

  // -------------------------------------------------------------------------
  // 내부 메서드
  // -------------------------------------------------------------------------

  /**
   * 알림톡을 발송하는 공통 메서드
   */
  private async send(
    templateType: AlimtalkTemplateCode,
    phone: string,
    variables: TemplateVariables,
    buttons?: Array<{ type: string; name: string; linkMobile?: string; linkPc?: string }>,
  ): Promise<AlimtalkSendResponse> {
    const templateCode = TEMPLATE_CODES[templateType];

    const templateParameter: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined) {
        templateParameter[key] = value;
      }
    }

    const requestBody: AlimtalkSendRequest = {
      senderKey: this.senderKey,
      templateCode,
      recipientList: [
        {
          recipientNo: phone,
          templateParameter,
          ...(buttons && { buttons }),
        },
      ],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.apiUrl}/v2/sender/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Secret-Key': this.apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      const body = await res.json();

      if (!res.ok) {
        throw new AlimtalkError(
          body.code ?? String(res.status),
          body.message ?? '알림톡 발송에 실패했습니다.',
        );
      }

      return {
        requestId: body.requestId ?? body.message?.requestId ?? '',
        success: true,
      };
    } catch (error) {
      if (error instanceof AlimtalkError) throw error;

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AlimtalkError('TIMEOUT', `알림톡 발송 타임아웃 (${this.timeout}ms)`);
      }

      throw new AlimtalkError(
        'NETWORK_ERROR',
        `알림톡 발송 중 네트워크 오류: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** 휴대폰번호 형식 검증 */
  private validatePhone(phone: string): void {
    if (!phone || !/^01[016789]\d{7,8}$/.test(phone)) {
      throw new AlimtalkError(
        'INVALID_PHONE',
        '유효하지 않은 휴대폰번호입니다. (예: 01012345678)',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 싱글턴
// ---------------------------------------------------------------------------

let defaultAlimtalkClient: KakaoAlimtalkClient | null = null;

/**
 * 환경변수에서 설정을 읽어 기본 KakaoAlimtalkClient를 반환합니다.
 * 환경변수가 설정되지 않은 경우 null을 반환합니다.
 */
export function getAlimtalkClient(): KakaoAlimtalkClient | null {
  if (defaultAlimtalkClient) return defaultAlimtalkClient;

  try {
    defaultAlimtalkClient = new KakaoAlimtalkClient();
    return defaultAlimtalkClient;
  } catch {
    return null;
  }
}
