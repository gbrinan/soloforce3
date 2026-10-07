/**
 * TossCert (토스 인증서) 본인인증 및 전자서명 서비스
 *
 * 토스 인증서를 통해 본인인증 요청을 보내고,
 * 사용자가 토스 앱에서 인증을 완료하면 결과를 조회합니다.
 *
 * @example
 * ```ts
 * const tossCert = new TossCert(getBarocertClient());
 * const { receiptID } = await tossCert.requestIdentityVerification(
 *   '01012345678', '홍길동', '19900101',
 * );
 * ```
 */

import { BarocertClient, BarocertError } from './index';
import type {
  IdentityVerificationRequest,
  IdentityVerificationResponse,
  IdentityVerificationResult,
  IdentityVerificationStatus,
  SignRequest,
  SignResponse,
  SignResult,
  SignStatus,
} from './types';

const PROVIDER = 'TOSS';

export class TossCert {
  private readonly client: BarocertClient;

  constructor(client: BarocertClient) {
    this.client = client;
  }

  // -------------------------------------------------------------------------
  // 본인인증
  // -------------------------------------------------------------------------

  /**
   * 토스 본인인증을 요청합니다.
   *
   * @param receiverHP - 수신자 휴대폰번호 (하이픈 없이, 예: 01012345678)
   * @param receiverName - 수신자 성명
   * @param receiverBirthday - 수신자 생년월일 (YYYYMMDD)
   * @param options - 추가 옵션 (reqTitle, expireIn 등)
   * @returns 접수 아이디가 포함된 응답
   */
  async requestIdentityVerification(
    receiverHP: string,
    receiverName: string,
    receiverBirthday: string,
    options?: Pick<IdentityVerificationRequest, 'reqTitle' | 'expireIn' | 'appUseYN' | 'requestID'>,
  ): Promise<IdentityVerificationResponse> {
    this.validateReceiverInfo(receiverHP, receiverName, receiverBirthday);

    const clientCode = this.client.getClientCode();
    const body: Record<string, unknown> = {
      receiverHP,
      receiverName,
      receiverBirthday,
      reqTitle: options?.reqTitle ?? '본인인증 요청',
      expireIn: options?.expireIn ?? 300,
      appUseYN: options?.appUseYN ?? false,
      ...(options?.requestID && { requestID: options.requestID }),
    };

    return this.client.post<IdentityVerificationResponse>(
      `/${PROVIDER}/identity/${clientCode}`,
      body,
    );
  }

  /**
   * 토스 본인인증 상태를 조회합니다.
   *
   * @param receiptID - 접수 아이디
   * @returns 상태 정보 (state: 0=대기, 1=완료, 2=만료, 3=거부, 4=실패)
   */
  async getIdentityVerificationStatus(
    receiptID: string,
  ): Promise<IdentityVerificationStatus> {
    this.validateReceiptID(receiptID);

    const clientCode = this.client.getClientCode();

    return this.client.get<IdentityVerificationStatus>(
      `/${PROVIDER}/identity/${clientCode}/${receiptID}`,
    );
  }

  /**
   * 토스 본인인증 결과를 확인합니다.
   * 사용자가 인증을 완료(state=1)한 후에만 호출해야 합니다.
   *
   * @param receiptID - 접수 아이디
   * @returns CI, DI 등이 포함된 인증 결과
   */
  async verifyIdentity(
    receiptID: string,
  ): Promise<IdentityVerificationResult> {
    this.validateReceiptID(receiptID);

    const clientCode = this.client.getClientCode();

    return this.client.post<IdentityVerificationResult>(
      `/${PROVIDER}/identity/${clientCode}/${receiptID}`,
      {},
    );
  }

  // -------------------------------------------------------------------------
  // 전자서명
  // -------------------------------------------------------------------------

  /**
   * 토스 전자서명을 요청합니다.
   *
   * @param receiverHP - 수신자 휴대폰번호 (하이픈 없이)
   * @param receiverName - 수신자 성명
   * @param receiverBirthday - 수신자 생년월일 (YYYYMMDD)
   * @param token - 서명할 원문 (Base64 인코딩)
   * @param options - 추가 옵션 (reqTitle, reqMessage, tokenType 등)
   * @returns 접수 아이디가 포함된 응답
   */
  async requestSign(
    receiverHP: string,
    receiverName: string,
    receiverBirthday: string,
    token: string,
    options?: Pick<SignRequest, 'reqTitle' | 'reqMessage' | 'expireIn' | 'tokenType' | 'appUseYN' | 'requestID'>,
  ): Promise<SignResponse> {
    this.validateReceiverInfo(receiverHP, receiverName, receiverBirthday);

    if (!token) {
      throw new BarocertError(-1, '서명할 원문(token)은 필수입니다.');
    }

    const clientCode = this.client.getClientCode();
    const body: Record<string, unknown> = {
      receiverHP,
      receiverName,
      receiverBirthday,
      token,
      reqTitle: options?.reqTitle ?? '전자서명 요청',
      reqMessage: options?.reqMessage,
      expireIn: options?.expireIn ?? 300,
      tokenType: options?.tokenType ?? 'TEXT',
      appUseYN: options?.appUseYN ?? false,
      ...(options?.requestID && { requestID: options.requestID }),
    };

    return this.client.post<SignResponse>(
      `/${PROVIDER}/sign/${clientCode}`,
      body,
    );
  }

  /**
   * 토스 전자서명 상태를 조회합니다.
   *
   * @param receiptID - 접수 아이디
   * @returns 상태 정보 (state: 0=대기, 1=완료, 2=만료, 3=거부, 4=실패)
   */
  async getSignStatus(receiptID: string): Promise<SignStatus> {
    this.validateReceiptID(receiptID);

    const clientCode = this.client.getClientCode();

    return this.client.get<SignStatus>(
      `/${PROVIDER}/sign/${clientCode}/${receiptID}`,
    );
  }

  /**
   * 토스 전자서명 결과를 확인합니다.
   * 사용자가 서명을 완료(state=1)한 후에만 호출해야 합니다.
   *
   * @param receiptID - 접수 아이디
   * @returns 서명 데이터가 포함된 결과
   */
  async verifySign(receiptID: string): Promise<SignResult> {
    this.validateReceiptID(receiptID);

    const clientCode = this.client.getClientCode();

    return this.client.post<SignResult>(
      `/${PROVIDER}/sign/${clientCode}/${receiptID}`,
      {},
    );
  }

  // -------------------------------------------------------------------------
  // 검증 유틸리티
  // -------------------------------------------------------------------------

  private validateReceiverInfo(
    receiverHP: string,
    receiverName: string,
    receiverBirthday: string,
  ): void {
    if (!receiverHP || !/^01[016789]\d{7,8}$/.test(receiverHP)) {
      throw new BarocertError(-1, '유효하지 않은 휴대폰번호입니다. (예: 01012345678)');
    }
    if (!receiverName || receiverName.trim().length === 0) {
      throw new BarocertError(-1, '수신자 성명은 필수입니다.');
    }
    if (!receiverBirthday || !/^\d{8}$/.test(receiverBirthday)) {
      throw new BarocertError(-1, '생년월일은 YYYYMMDD 형식이어야 합니다.');
    }
  }

  private validateReceiptID(receiptID: string): void {
    if (!receiptID || receiptID.trim().length === 0) {
      throw new BarocertError(-1, '접수 아이디(receiptID)는 필수입니다.');
    }
  }
}
