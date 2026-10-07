/**
 * 알림 디스패처
 *
 * 설정 및 사용자 선호에 따라 이메일 또는 카카오 알림톡으로
 * 알림을 라우팅합니다.
 *
 * 우선순위:
 * 1. 카카오 알림톡 (한국 휴대폰번호가 있고 Alimtalk 설정이 되어 있을 때)
 * 2. 이메일 (Resend, 기본 폴백)
 *
 * @example
 * ```ts
 * const dispatcher = new NotificationDispatcher();
 * await dispatcher.notifySigningRequest({
 *   signerName: '홍길동',
 *   documentName: '근로계약서',
 *   signingUrl: 'https://sign.example.com/abc',
 *   phone: '01012345678',
 *   email: 'hong@example.com',
 * });
 * ```
 */

import {
  KakaoAlimtalkClient,
  getAlimtalkClient,
  type AlimtalkSendResponse,
} from './kakao-alimtalk';

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

/** 알림 채널 */
export type NotificationChannel = 'kakao' | 'email';

/** 알림 수신자 정보 */
export interface NotificationRecipient {
  /** 수신자 이름 */
  signerName: string;
  /** 수신자 이메일 (이메일 알림용) */
  email?: string;
  /** 수신자 휴대폰번호 (알림톡용, 하이픈 없이) */
  phone?: string;
  /** 선호 알림 채널 (미지정 시 자동 결정) */
  preferredChannel?: NotificationChannel;
}

/** 서명 요청 알림 파라미터 */
export interface SigningRequestNotification extends NotificationRecipient {
  documentName: string;
  signingUrl: string;
}

/** 서명 완료 알림 파라미터 */
export interface SigningCompleteNotification extends NotificationRecipient {
  documentName: string;
}

/** 서명 리마인더 알림 파라미터 */
export interface SigningReminderNotification extends NotificationRecipient {
  documentName: string;
  signingUrl: string;
}

/** 본인인증 요청 알림 파라미터 */
export interface VerificationRequestNotification extends NotificationRecipient {}

/** 알림 발송 결과 */
export interface NotificationResult {
  /** 사용된 채널 */
  channel: NotificationChannel;
  /** 성공 여부 */
  success: boolean;
  /** 에러 메시지 (실패 시) */
  errorMessage?: string;
  /** 카카오 알림톡 응답 (알림톡 사용 시) */
  alimtalkResponse?: AlimtalkSendResponse;
}

/** 이메일 발송 함수 시그니처 (의존성 주입용) */
export type EmailSender = (params: {
  to: string;
  subject: string;
  html: string;
}) => Promise<{ success: boolean; errorMessage?: string }>;

// ---------------------------------------------------------------------------
// 디스패처
// ---------------------------------------------------------------------------

export class NotificationDispatcher {
  private readonly alimtalkClient: KakaoAlimtalkClient | null;
  private readonly emailSender: EmailSender | null;

  /**
   * @param emailSender - 이메일 발송 함수 (선택). 미제공 시 이메일 알림 불가.
   * @param alimtalkClient - KakaoAlimtalkClient 인스턴스 (선택). 미제공 시 환경변수에서 자동 생성.
   */
  constructor(
    emailSender?: EmailSender | null,
    alimtalkClient?: KakaoAlimtalkClient | null,
  ) {
    this.emailSender = emailSender ?? null;
    this.alimtalkClient = alimtalkClient !== undefined
      ? alimtalkClient
      : getAlimtalkClient();
  }

  // -------------------------------------------------------------------------
  // 공개 메서드
  // -------------------------------------------------------------------------

  /**
   * 서명 요청 알림을 발송합니다.
   */
  async notifySigningRequest(
    params: SigningRequestNotification,
  ): Promise<NotificationResult> {
    const channel = this.resolveChannel(params);

    if (channel === 'kakao' && this.alimtalkClient && params.phone) {
      return this.sendViaKakao(async () =>
        this.alimtalkClient!.sendSigningRequest(
          params.phone!,
          params.signerName,
          params.documentName,
          params.signingUrl,
        ),
      );
    }

    return this.sendViaEmail(params.email, {
      subject: `[서명 요청] ${params.documentName}`,
      html: this.buildSigningRequestEmailHtml(params),
    });
  }

  /**
   * 서명 완료 알림을 발송합니다.
   */
  async notifySigningComplete(
    params: SigningCompleteNotification,
  ): Promise<NotificationResult> {
    const channel = this.resolveChannel(params);

    if (channel === 'kakao' && this.alimtalkClient && params.phone) {
      return this.sendViaKakao(async () =>
        this.alimtalkClient!.sendSigningComplete(
          params.phone!,
          params.signerName,
          params.documentName,
        ),
      );
    }

    return this.sendViaEmail(params.email, {
      subject: `[서명 완료] ${params.documentName}`,
      html: this.buildSigningCompleteEmailHtml(params),
    });
  }

  /**
   * 서명 리마인더 알림을 발송합니다.
   */
  async notifySigningReminder(
    params: SigningReminderNotification,
  ): Promise<NotificationResult> {
    const channel = this.resolveChannel(params);

    if (channel === 'kakao' && this.alimtalkClient && params.phone) {
      return this.sendViaKakao(async () =>
        this.alimtalkClient!.sendSigningReminder(
          params.phone!,
          params.signerName,
          params.documentName,
          params.signingUrl,
        ),
      );
    }

    return this.sendViaEmail(params.email, {
      subject: `[리마인더] ${params.documentName} 서명을 완료해 주세요`,
      html: this.buildSigningReminderEmailHtml(params),
    });
  }

  /**
   * 본인인증 요청 알림을 발송합니다.
   */
  async notifyVerificationRequest(
    params: VerificationRequestNotification,
  ): Promise<NotificationResult> {
    const channel = this.resolveChannel(params);

    if (channel === 'kakao' && this.alimtalkClient && params.phone) {
      return this.sendViaKakao(async () =>
        this.alimtalkClient!.sendVerificationRequest(
          params.phone!,
          params.signerName,
        ),
      );
    }

    return this.sendViaEmail(params.email, {
      subject: '[본인인증] 본인인증을 완료해 주세요',
      html: this.buildVerificationRequestEmailHtml(params),
    });
  }

  // -------------------------------------------------------------------------
  // 채널 결정
  // -------------------------------------------------------------------------

  /**
   * 수신자 정보와 시스템 설정에 따라 알림 채널을 결정합니다.
   *
   * 우선순위:
   * 1. 사용자 명시적 선호 (preferredChannel)
   * 2. 카카오 알림톡 (phone이 있고 클라이언트가 설정되어 있을 때)
   * 3. 이메일 (기본 폴백)
   */
  private resolveChannel(recipient: NotificationRecipient): NotificationChannel {
    if (recipient.preferredChannel) {
      return recipient.preferredChannel;
    }

    if (recipient.phone && this.alimtalkClient) {
      return 'kakao';
    }

    return 'email';
  }

  // -------------------------------------------------------------------------
  // 카카오 알림톡 발송
  // -------------------------------------------------------------------------

  private async sendViaKakao(
    fn: () => Promise<AlimtalkSendResponse>,
  ): Promise<NotificationResult> {
    try {
      const response = await fn();
      return {
        channel: 'kakao',
        success: response.success,
        errorMessage: response.errorMessage,
        alimtalkResponse: response,
      };
    } catch (error) {
      return {
        channel: 'kakao',
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // -------------------------------------------------------------------------
  // 이메일 발송
  // -------------------------------------------------------------------------

  private async sendViaEmail(
    to: string | undefined,
    params: { subject: string; html: string },
  ): Promise<NotificationResult> {
    if (!to) {
      return {
        channel: 'email',
        success: false,
        errorMessage: '이메일 주소가 제공되지 않았습니다.',
      };
    }

    if (!this.emailSender) {
      return {
        channel: 'email',
        success: false,
        errorMessage: '이메일 발송 기능이 설정되지 않았습니다.',
      };
    }

    try {
      const result = await this.emailSender({
        to,
        subject: params.subject,
        html: params.html,
      });
      return {
        channel: 'email',
        success: result.success,
        errorMessage: result.errorMessage,
      };
    } catch (error) {
      return {
        channel: 'email',
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // -------------------------------------------------------------------------
  // 이메일 HTML 템플릿
  // -------------------------------------------------------------------------

  private buildSigningRequestEmailHtml(params: SigningRequestNotification): string {
    return `
      <div style="font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>서명 요청</h2>
        <p>${params.signerName}님, 아래 문서에 대한 서명이 요청되었습니다.</p>
        <p><strong>문서명:</strong> ${params.documentName}</p>
        <a href="${params.signingUrl}"
           style="display: inline-block; padding: 12px 24px; background: #4F46E5; color: #fff; text-decoration: none; border-radius: 6px; margin-top: 16px;">
          서명하기
        </a>
      </div>
    `.trim();
  }

  private buildSigningCompleteEmailHtml(params: SigningCompleteNotification): string {
    return `
      <div style="font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>서명 완료</h2>
        <p>${params.signerName}님, 아래 문서의 서명이 완료되었습니다.</p>
        <p><strong>문서명:</strong> ${params.documentName}</p>
      </div>
    `.trim();
  }

  private buildSigningReminderEmailHtml(params: SigningReminderNotification): string {
    return `
      <div style="font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>서명 리마인더</h2>
        <p>${params.signerName}님, 아래 문서의 서명이 아직 완료되지 않았습니다.</p>
        <p><strong>문서명:</strong> ${params.documentName}</p>
        <a href="${params.signingUrl}"
           style="display: inline-block; padding: 12px 24px; background: #4F46E5; color: #fff; text-decoration: none; border-radius: 6px; margin-top: 16px;">
          서명하기
        </a>
      </div>
    `.trim();
  }

  private buildVerificationRequestEmailHtml(params: VerificationRequestNotification): string {
    return `
      <div style="font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>본인인증 요청</h2>
        <p>${params.signerName}님, 문서 서명을 위해 본인인증이 필요합니다.</p>
        <p>카카오톡, 네이버 또는 토스 앱에서 인증을 완료해 주세요.</p>
      </div>
    `.trim();
  }
}

// ---------------------------------------------------------------------------
// 싱글턴
// ---------------------------------------------------------------------------

let defaultDispatcher: NotificationDispatcher | null = null;

/**
 * 기본 NotificationDispatcher 인스턴스를 반환합니다.
 *
 * @param emailSender - 이메일 발송 함수 (최초 호출 시에만 적용)
 */
export function getNotificationDispatcher(
  emailSender?: EmailSender,
): NotificationDispatcher {
  if (defaultDispatcher) return defaultDispatcher;

  defaultDispatcher = new NotificationDispatcher(emailSender);
  return defaultDispatcher;
}
