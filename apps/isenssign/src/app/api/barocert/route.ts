/**
 * Barocert API 라우트
 *
 * POST /api/barocert - 본인인증 또는 전자서명 요청
 * GET  /api/barocert - 상태 조회 및 결과 확인
 */

import type { NextRequest } from 'next/server';
import { getBarocertClient, BarocertError } from '@/lib/barocert';
import { KakaoCert } from '@/lib/barocert/kakaocert';
import { NaverCert } from '@/lib/barocert/navercert';
import { TossCert } from '@/lib/barocert/tosscert';
import type {
  BarocertApiRequest,
  CertProvider,
} from '@/lib/barocert/types';

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

type CertService = KakaoCert | NaverCert | TossCert;

function getCertService(provider: CertProvider): CertService {
  const client = getBarocertClient();

  switch (provider) {
    case 'kakao':
      return new KakaoCert(client);
    case 'naver':
      return new NaverCert(client);
    case 'toss':
      return new TossCert(client);
    default:
      throw new BarocertError(-1, `지원하지 않는 인증서 공급자입니다: ${provider}`);
  }
}

function errorResponse(status: number, code: number | string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

// ---------------------------------------------------------------------------
// POST /api/barocert
// ---------------------------------------------------------------------------

/**
 * 본인인증 또는 전자서명을 요청합니다.
 *
 * 요청 바디:
 * ```json
 * {
 *   "provider": "kakao" | "naver" | "toss",
 *   "type": "identity" | "sign",
 *   "receiverInfo": {
 *     "receiverHP": "01012345678",
 *     "receiverName": "홍길동",
 *     "receiverBirthday": "19900101"
 *   },
 *   "token": "Base64 encoded text (sign only)",
 *   "reqTitle": "서명 제목 (선택)",
 *   "reqMessage": "서명 메시지 (선택)"
 * }
 * ```
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BarocertApiRequest;

    // 필수 필드 검증
    if (!body.provider || !body.type || !body.receiverInfo) {
      return errorResponse(400, 'INVALID_REQUEST', 'provider, type, receiverInfo는 필수입니다.');
    }

    const { provider, type, receiverInfo, token, reqTitle, reqMessage } = body;

    if (!['kakao', 'naver', 'toss'].includes(provider)) {
      return errorResponse(400, 'INVALID_PROVIDER', '지원하지 않는 인증서 공급자입니다.');
    }

    if (!['identity', 'sign'].includes(type)) {
      return errorResponse(400, 'INVALID_TYPE', 'type은 identity 또는 sign이어야 합니다.');
    }

    const service = getCertService(provider);
    const { receiverHP, receiverName, receiverBirthday } = receiverInfo;

    if (type === 'identity') {
      const result = await service.requestIdentityVerification(
        receiverHP,
        receiverName,
        receiverBirthday,
        { reqTitle },
      );

      return Response.json({
        receiptID: result.receiptID,
        provider,
        type,
      });
    }

    // type === 'sign'
    if (!token) {
      return errorResponse(400, 'MISSING_TOKEN', '전자서명 요청에는 token이 필수입니다.');
    }

    const result = await service.requestSign(
      receiverHP,
      receiverName,
      receiverBirthday,
      token,
      { reqTitle, reqMessage },
    );

    return Response.json({
      receiptID: result.receiptID,
      provider,
      type,
    });
  } catch (error) {
    if (error instanceof BarocertError) {
      return errorResponse(400, error.code, error.message);
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    return errorResponse(500, 'INTERNAL_ERROR', message);
  }
}

// ---------------------------------------------------------------------------
// GET /api/barocert
// ---------------------------------------------------------------------------

/**
 * 본인인증 또는 전자서명 상태를 조회하고, 선택적으로 결과를 확인합니다.
 *
 * 쿼리 파라미터:
 * - receiptId (필수): 접수 아이디
 * - provider (필수): kakao | naver | toss
 * - type (필수): identity | sign
 * - verify (선택): true이면 결과 확인까지 수행
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const receiptId = searchParams.get('receiptId');
    const provider = searchParams.get('provider') as CertProvider | null;
    const type = searchParams.get('type') as 'identity' | 'sign' | null;
    const verify = searchParams.get('verify') === 'true';

    if (!receiptId || !provider || !type) {
      return errorResponse(400, 'INVALID_REQUEST', 'receiptId, provider, type은 필수입니다.');
    }

    if (!['kakao', 'naver', 'toss'].includes(provider)) {
      return errorResponse(400, 'INVALID_PROVIDER', '지원하지 않는 인증서 공급자입니다.');
    }

    const service = getCertService(provider);

    if (type === 'identity') {
      const status = await service.getIdentityVerificationStatus(receiptId);

      // 인증 완료 상태(1)이고 verify=true이면 결과까지 조회
      if (verify && status.state === 1) {
        const result = await service.verifyIdentity(receiptId);
        return Response.json({ status, result });
      }

      return Response.json({ status });
    }

    if (type === 'sign') {
      const status = await service.getSignStatus(receiptId);

      // 서명 완료 상태(1)이고 verify=true이면 결과까지 조회
      if (verify && status.state === 1) {
        const result = await service.verifySign(receiptId);
        return Response.json({ status, result });
      }

      return Response.json({ status });
    }

    return errorResponse(400, 'INVALID_TYPE', 'type은 identity 또는 sign이어야 합니다.');
  } catch (error) {
    if (error instanceof BarocertError) {
      return errorResponse(400, error.code, error.message);
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    return errorResponse(500, 'INTERNAL_ERROR', message);
  }
}
