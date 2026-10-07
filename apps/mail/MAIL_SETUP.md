# MyMail 연동 설정 가이드

앱 ID: `mail` · 포트: `3462`  
송신: Resend SDK · 수신: Cloudflare Email Workers + PostalMime + R2

---

## 1. 필요한 환경변수

### 1-1. Next.js 앱 (`.env.local`)

| 변수 | 설명 | 필수 |
|------|------|------|
| `RESEND_API_KEY` | Resend 대시보드 → API Keys에서 발급 | ✅ 송신 |
| `INBOUND_WEBHOOK_SECRET` | CF 워커와 공유하는 임의 비밀값 (32자 이상 랜덤) | ✅ 수신 |
| `RESEND_DEFAULT_FROM` | 기본 발신 주소 (예: `hello@yourdomain.com`) | 권장 |

```bash
# .env.local 예시
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
INBOUND_WEBHOOK_SECRET=<openssl rand -hex 32 로 생성>
RESEND_DEFAULT_FROM=hello@yourdomain.com
```

### 1-2. Cloudflare Email Worker (`wrangler secret`)

```bash
cd apps/mail/workers/email-worker

# 같은 값을 CF 워커 시크릿으로 등록
wrangler secret put INBOUND_WEBHOOK_SECRET
# 프롬프트에 .env.local과 동일한 값 입력
```

---

## 2. Resend 도메인 인증 (송신)

1. [https://resend.com](https://resend.com) 가입 → **Domains** → **Add Domain**
2. 도메인 입력 (예: `yourdomain.com`)
3. Resend가 안내하는 DNS 레코드 추가:
   - `SPF` TXT 레코드
   - `DKIM` CNAME 레코드 3개
   - `DMARC` TXT 레코드 (권장)
4. DNS 전파 후 **Verify** 클릭 → ✅ 상태 확인
5. **API Keys** 탭 → 키 생성 → `RESEND_API_KEY`에 저장

> **주의**: 인증되지 않은 도메인의 주소를 `from`에 쓰면 Resend가 400을 반환합니다.

---

## 3. Cloudflare Email Routing 설정 (수신)

### 전제 조건
- 도메인의 DNS 네임서버가 Cloudflare로 위임돼 있어야 합니다.
- Cloudflare 대시보드 → 해당 도메인 → **Email** 탭이 보여야 합니다.

### 3-1. Email Routing 활성화
1. Cloudflare 대시보드 → 도메인 → **Email** → **Email Routing**
2. **Enable Email Routing** 클릭
3. Cloudflare가 추가를 요청하는 MX/TXT 레코드를 DNS에 추가

### 3-2. Email Worker 배포

```bash
cd apps/mail/workers/email-worker
npm install

# wrangler.toml 편집:
#   bucket_name = "mycrew-mail-attachments"  (실제 R2 버킷명)
#   INBOUND_WEBHOOK_URL = "https://yourdomain.com/api/mail/inbound"

# R2 버킷 생성 (없으면)
wrangler r2 bucket create mycrew-mail-attachments

# 배포
wrangler deploy --env production
```

### 3-3. Catch-all 룰 등록

1. Cloudflare 대시보드 → **Email Routing** → **Routing Rules**
2. **Catch-all** 행 → **Edit** → Action: **Send to a Worker**
3. Worker: `mycrew-email-worker` 선택 → **Save**

> 특정 주소별로 라우팅하려면 **Create address** → Action: Worker로 추가하세요.

---

## 4. 아키텍처 흐름

```
외부 발신자
    │
    │  SMTP → Cloudflare MX
    ▼
Cloudflare Email Routing
    │  catch-all → Worker
    ▼
mycrew-email-worker (CF Worker)
    │  1. PostalMime 파싱
    │  2. 첨부파일 → R2 업로드
    │  3. POST /api/mail/inbound  (X-Mail-Worker-Secret 헤더)
    ▼
Next.js /api/mail/inbound (apps/mail/src/app/api/mail/inbound/route.ts)
    │  1. Secret 검증
    │  2. saveInboundMail() 호출 (백엔드 CRUD 구현체)
    ▼
DB (백엔드가 연결하는 저장소)

────────────────────────────────────────────────────────

사용자 → ComposeScreen → POST /api/mail/send
    ▼
Next.js /api/mail/send
    │  sendMail() 호출  (apps/mail/src/lib/mail/transport.ts)
    ▼
Resend API → 수신자 SMTP
```

---

## 5. 개발환경 로컬 테스트

### 수신 테스트 (webhook 시뮬)

CF 워커 없이 수신 웹훅만 테스트하려면:

```bash
curl -X POST http://localhost:3462/api/mail/inbound \
  -H "Content-Type: application/json" \
  -H "X-Mail-Worker-Secret: <INBOUND_WEBHOOK_SECRET 값>" \
  -d '{
    "messageId": "test-001",
    "from": "sender@example.com",
    "fromName": "테스트 발신자",
    "to": ["hello@yourdomain.com"],
    "subject": "테스트 메일",
    "text": "안녕하세요.",
    "receivedAt": "2026-06-24T15:00:00.000Z",
    "attachments": []
  }'
```

### 송신 테스트

실제 Resend API를 호출하므로 과금 주의.  
`RESEND_API_KEY` 없이 호출하면 `ok: false, error: "RESEND_API_KEY not set"` 반환.

```bash
curl -X POST http://localhost:3462/api/mail/send \
  -H "Content-Type: application/json" \
  -d '{
    "from": "hello@yourdomain.com",
    "to": ["test@example.com"],
    "subject": "테스트",
    "text": "Resend 테스트"
  }'
```

---

## 6. 백엔드 연동 체크리스트

`apps/mail/src/app/api/mail/inbound/route.ts` 안의 `saveInboundMail` stub을 실제 DB 저장 함수로 교체하면 연동 완료:

```typescript
// 구현할 함수 시그니처 (transport.ts에 정의된 SaveInboundMailFn 타입 참고)
const saveInboundMail: SaveInboundMailFn = async (mailboxAddress, mail) => {
  // 실제 DB insert 구현
  const record = await db.mails.create({ mailboxAddress, ...mail });
  return { id: record.id };
};
```

송신 API 엔드포인트(`POST /api/mail/send`)도 필요하면 `sendMail()`을 import해 얇은 route handler로 감싸면 됩니다.

---

## 7. 파일 구조 요약

```
apps/mail/
  src/
    lib/
      mail/
        transport.ts              ← 송신 함수 + 수신 타입 계약 (백엔드)
    app/
      api/
        mail/
          inbound/
            route.ts              ← 수신 웹훅 핸들러 (백엔드 scaffold, CRUD 연결)
  workers/
    email-worker/
      src/
        index.ts                  ← CF Email Worker (백엔드)
      wrangler.toml               ← 바인딩 템플릿 (백엔드)
      package.json
      tsconfig.json
  MAIL_SETUP.md                   ← 이 파일
```
