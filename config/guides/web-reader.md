# 웹 리더 (ReadWebPage)

차단되거나 페이월이 걸린 공개 웹페이지의 본문 텍스트를 최대한 정직하게 수집하는 도구.

## 무엇을 하는가

일반적인 fetch가 403/CAPTCHA/WAF 등으로 막히는 경우, 브라우저 헤더 위장과 무료 리더 프록시(Jina Reader)를 순서대로 시도해 공개된 텍스트를 가져온다. 헤드리스 브라우저나 로그인 우회 기능은 없다 — 로그인/페이월이 감지되면 우회하지 않고 `authRequired: true`로 정직하게 종료한다.

## 우회 전략 체인

1. **direct** — 실제 크롬과 유사한 브라우저 헤더(User-Agent, Accept, Sec-Fetch-*)로 직접 fetch. 성공하면 OGP/JSON-LD 메타데이터와 본문 텍스트를 추출.
2. **jina-reader** — direct가 403/429/CAPTCHA 마커 등으로 차단되면 `https://r.jina.ai/<원본 URL>`로 요청. Jina Reader는 무료 티어이며 API 키가 필요 없다. 대부분의 페이지에서 깔끔한 텍스트를 반환하는 가장 효과가 큰 폴백.
3. **authRequired** — 로그인 유도 문구, 구독 안내, 페이월 클래스명 등이 감지되면 모든 전략에서 우회 시도 없이 `authRequired: true`로 종료.

## 보안 — SSRF 차단

대상 URL의 호스트는 모든 전략(Jina Reader 프록시 호출 포함)을 시도하기 **이전에** 반드시 `isSafeHost`로 검증한다. localhost, 127.0.0.1, 169.254.169.254(클라우드 메타데이터), 10.x/172.16-31.x/192.168.x 등 사설 대역은 전부 차단되며, Jina 프록시에도 동일하게 적용된다 (그렇지 않으면 우리 서버가 내부망 오픈 프록시가 될 수 있음).

## 사용법

- MCP 도구: `ReadWebPage` (readPaths가 있는 직원에게 자동 허용)
- REST: `POST /api/web-reader` — body `{"url": "https://example.com/article"}`

## 주의사항 (DISCLAIMER)

- **공개 콘텐츠 수집용**이다. 로그인이 필요한 콘텐츠나 페이월 콘텐츠를 우회하는 기능이 아니다.
- 대상 사이트의 이용약관(ToS)에 유의해야 한다. 크롤링을 명시적으로 금지하는 사이트에는 사용하지 않는다.
- JS로만 렌더링되는 페이지(SPA)나 강한 CAPTCHA 챌린지는 헤드리스 브라우저가 없어 우회할 수 없다 — 이 경우 `authRequired` 또는 에러로 종료된다.
- Jina Reader는 무료 티어 요청 제한(rate limit)이 있다. 대량 호출 시 실패가 늘어날 수 있다.
- 결과 텍스트는 최대 100KB로 잘리며, 잘린 경우 `truncated: true`가 표시된다.
