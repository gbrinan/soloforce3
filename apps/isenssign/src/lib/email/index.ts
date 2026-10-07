/**
 * 이메일 발송 서비스
 * Resend API를 사용한 트랜잭셔널 이메일 발송
 */
import { Resend } from "resend";
import {
  SigningRequestEmail,
  SigningCompleteEmail,
  SigningReminderEmail,
} from "./templates";

let _resend: Resend | null = null;
function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY || "re_placeholder");
  }
  return _resend;
}
const FROM_EMAIL = process.env.EMAIL_FROM || "noreply@isenssign.com";

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * 서명 요청 이메일 발송
 */
export async function sendSigningRequestEmail(params: {
  to: string;
  signerName: string;
  senderName: string;
  documentName: string;
  signingUrl: string;
  expiresAt?: string;
  message?: string;
}): Promise<SendEmailResult> {
  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: `[서명 요청] ${params.senderName}님이 "${params.documentName}" 문서의 서명을 요청했습니다`,
      react: SigningRequestEmail({
        signerName: params.signerName,
        senderName: params.senderName,
        documentName: params.documentName,
        signingUrl: params.signingUrl,
        expiresAt: params.expiresAt,
        message: params.message,
      }),
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, id: data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "이메일 발송 실패",
    };
  }
}

/**
 * 서명 완료 이메일 발송
 */
export async function sendSigningCompleteEmail(params: {
  to: string;
  signerName: string;
  documentName: string;
  completedAt: string;
  downloadUrl: string;
}): Promise<SendEmailResult> {
  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: `[서명 완료] "${params.documentName}" 문서의 서명이 완료되었습니다`,
      react: SigningCompleteEmail({
        signerName: params.signerName,
        documentName: params.documentName,
        completedAt: params.completedAt,
        downloadUrl: params.downloadUrl,
      }),
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, id: data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "이메일 발송 실패",
    };
  }
}

/**
 * 서명 리마인더 이메일 발송
 */
export async function sendSigningReminderEmail(params: {
  to: string;
  signerName: string;
  senderName: string;
  documentName: string;
  signingUrl: string;
  expiresAt?: string;
}): Promise<SendEmailResult> {
  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: `[리마인더] "${params.documentName}" 문서의 서명을 완료해주세요`,
      react: SigningReminderEmail({
        signerName: params.signerName,
        senderName: params.senderName,
        documentName: params.documentName,
        signingUrl: params.signingUrl,
        expiresAt: params.expiresAt,
      }),
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, id: data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "이메일 발송 실패",
    };
  }
}
