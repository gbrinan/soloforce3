/**
 * Barocert 클라이언트
 *
 * Linkhub 토큰 인증 및 HMAC-SHA256 서명을 통해
 * Barocert API와 통신하는 HTTP 클라이언트입니다.
 *
 * @see https://developers.barocert.com
 */

import type {
  BarocertConfig,
  BarocertErrorResponse,
  LinkhubToken,
} from './types';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://barocert.linkhub.co.kr';
const DEFAULT_AUTH_URL = 'https://auth.linkhub.co.kr';
const DEFAULT_TIMEOUT = 30_000;

/** 토큰 유효 여분 시간 (밀리초). 만료 1분 전에 갱신한다. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

// ---------------------------------------------------------------------------
// 에러
// ---------------------------------------------------------------------------

/** Barocert API 호출 실패 시 발생하는 에러 */
export class BarocertError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BarocertError';
  }
}

// ---------------------------------------------------------------------------
// 클라이언트
// ---------------------------------------------------------------------------

export class BarocertClient {
  private readonly linkID: string;
  private readonly secretKey: string;
  private readonly clientCode: string;
  private readonly baseUrl: string;
  private readonly authUrl: string;
  private readonly timeout: number;

  /** 캐시된 토큰과 만료 시각 */
  private cachedToken: LinkhubToken | null = null;
  private tokenExpiresAt = 0;

  constructor(config: BarocertConfig) {
    if (!config.linkID || !config.secretKey || !config.clientCode) {
      throw new BarocertError(-1, 'linkID, secretKey, clientCode는 필수입니다.');
    }

    this.linkID = config.linkID;
    this.secretKey = config.secretKey;
    this.clientCode = config.clientCode;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.authUrl = (config.authUrl ?? DEFAULT_AUTH_URL).replace(/\/+$/, '');
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  /** 이용기관 코드 getter */
  getClientCode(): string {
    return this.clientCode;
  }

  // -------------------------------------------------------------------------
  // Linkhub 토큰
  // -------------------------------------------------------------------------

  /**
   * Linkhub 인증 토큰을 발급받거나 캐시된 토큰을 반환합니다.
   * 토큰이 만료 1분 이내이면 자동 갱신합니다.
   */
  async getToken(serviceID: string, scopes: string[]): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.cachedToken.session_token;
    }

    const postData = JSON.stringify({
      access_id: this.linkID,
      scope: scopes,
    });

    const uri = `/BAROCERT/${serviceID}/Token`;
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const hmacTarget = [
      'POST',
      await this.sha256Base64(postData),
      timestamp,
      uri,
    ].join('\n');

    const bearerToken = await this.hmacSha256Base64(this.secretKey, hmacTarget);

    const res = await this.fetchWithTimeout(`${this.authUrl}${uri}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-lh-date': timestamp,
        'x-lh-version': '2.0',
        Authorization: `LINKHUB ${this.linkID} ${bearerToken}`,
      },
      body: postData,
    });

    const body = await res.json();

    if (!res.ok) {
      const err = body as BarocertErrorResponse;
      throw new BarocertError(err.code, err.message);
    }

    const token = body as LinkhubToken;
    this.cachedToken = token;
    this.tokenExpiresAt = new Date(token.expiration).getTime();

    return token.session_token;
  }

  // -------------------------------------------------------------------------
  // Barocert API 요청
  // -------------------------------------------------------------------------

  /**
   * Barocert API에 POST 요청을 보냅니다.
   *
   * @param path - API 경로 (예: /KAKAO/identity/v1/01234567890)
   * @param body - 요청 바디 객체
   */
  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const token = await this.getToken('BAROCERT', ['partner', '310']);

    const postData = JSON.stringify(body);
    const uri = path.startsWith('/') ? path : `/${path}`;
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const hmacTarget = [
      'POST',
      await this.sha256Base64(postData),
      timestamp,
      uri,
    ].join('\n');

    const bearerToken = await this.hmacSha256Base64(this.secretKey, hmacTarget);

    const res = await this.fetchWithTimeout(`${this.baseUrl}${uri}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bc-date': timestamp,
        'x-bc-version': '2.0',
        'x-bc-auth': `Bearer ${token}`,
        Authorization: `LINKHUB ${this.linkID} ${bearerToken}`,
      },
      body: postData,
    });

    return this.handleResponse<T>(res);
  }

  /**
   * Barocert API에 GET 요청을 보냅니다.
   *
   * @param path - API 경로
   */
  async get<T>(path: string): Promise<T> {
    const token = await this.getToken('BAROCERT', ['partner', '310']);

    const uri = path.startsWith('/') ? path : `/${path}`;
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const hmacTarget = [
      'GET',
      '',
      timestamp,
      uri,
    ].join('\n');

    const bearerToken = await this.hmacSha256Base64(this.secretKey, hmacTarget);

    const res = await this.fetchWithTimeout(`${this.baseUrl}${uri}`, {
      method: 'GET',
      headers: {
        'x-bc-date': timestamp,
        'x-bc-version': '2.0',
        'x-bc-auth': `Bearer ${token}`,
        Authorization: `LINKHUB ${this.linkID} ${bearerToken}`,
      },
    });

    return this.handleResponse<T>(res);
  }

  // -------------------------------------------------------------------------
  // 내부 유틸리티
  // -------------------------------------------------------------------------

  /** 응답을 파싱하고 에러를 검사합니다. */
  private async handleResponse<T>(res: Response): Promise<T> {
    const body = await res.json();

    if (!res.ok) {
      const err = body as BarocertErrorResponse;
      throw new BarocertError(err.code ?? res.status, err.message ?? 'Unknown error');
    }

    return body as T;
  }

  /** 타임아웃이 적용된 fetch */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new BarocertError(-2, `요청 타임아웃 (${this.timeout}ms)`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** SHA-256 해시 → Base64 */
  private async sha256Base64(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return this.bufferToBase64(hashBuffer);
  }

  /** HMAC-SHA256 서명 → Base64 */
  private async hmacSha256Base64(keyBase64: string, data: string): Promise<string> {
    const keyBuffer = this.base64ToBuffer(keyBase64);
    const key = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
    return this.bufferToBase64(signature);
  }

  /** ArrayBuffer → Base64 문자열 */
  private bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /** Base64 문자열 → ArrayBuffer */
  private base64ToBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

// ---------------------------------------------------------------------------
// 싱글턴 인스턴스
// ---------------------------------------------------------------------------

let defaultClient: BarocertClient | null = null;

/**
 * 환경변수에서 설정을 읽어 기본 BarocertClient를 반환합니다.
 *
 * 필요한 환경변수:
 * - BAROCERT_LINK_ID
 * - BAROCERT_SECRET_KEY
 * - BAROCERT_CLIENT_CODE
 */
export function getBarocertClient(): BarocertClient {
  if (defaultClient) return defaultClient;

  const linkID = process.env.BAROCERT_LINK_ID;
  const secretKey = process.env.BAROCERT_SECRET_KEY;
  const clientCode = process.env.BAROCERT_CLIENT_CODE;

  if (!linkID || !secretKey || !clientCode) {
    throw new BarocertError(
      -1,
      'BAROCERT_LINK_ID, BAROCERT_SECRET_KEY, BAROCERT_CLIENT_CODE 환경변수가 필요합니다.',
    );
  }

  defaultClient = new BarocertClient({ linkID, secretKey, clientCode });
  return defaultClient;
}

export type { BarocertConfig } from './types';
