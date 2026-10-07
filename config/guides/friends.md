# 친구 (동료) 기능

## 개요
다른 teamLGS 인스턴스와 메시지를 주고받는 B2B 비서 통신 기능.
네트워크 설정(TUNNEL_URL 또는 NGROK_URL)이 필수. → `network-setup.md` 참조.

## 마이크루를 통해 할 수 있는 것 (사용자가 대화로 요청)

| 요청 예시 | 마이크루 동작 | MCP 도구 |
|-----------|----------|----------|
| "OO 회사랑 친구 추가해줘" + URL | RequestPartnership 호출 | RequestPartnership |
| "OO에게 메시지 보내줘" | SendToPartner 호출 | SendToPartner |
| "OO에게 파일 보내줘" | SendToPartner + attachments | SendToPartner |
| "토큰 갱신해줘" | RotatePartnerToken 호출 | RotatePartnerToken |

## 대시보드 UI로 할 수 있는 것

| 기능 | 위치 |
|------|------|
| 친구 추가 | 친구 탭 → 친구 신청 버튼 → URL 입력 |
| 메시지 보내기 | 친구 목록 선택 → 하단 입력창 |
| 파일 첨부 | 드래그 앤 드롭 또는 📎 버튼 |
| 친구 요청 승인/거부 | 친구 탭에 요청 카드 표시 |
| 친구 정보 수정 | 친구 목록에서 이름 클릭 |
| 메시지 확인 | 친구 목록 선택 → 메시지 타임라인 |

## 메시지 수신

- 상대방 메시지 수신 시 자동으로 마이크루에게 전달됨
- 마이크루가 A(회신)/B({{USER}}님 확인)/C(보고만) 중 선택해서 처리
- 친구 탭 헤더에 미처리 건수 뱃지 표시

## 파일 첨부

- 대시보드: 드래그 앤 드롭 또는 📎 버튼
- 마이크루: SendToPartner의 attachments에 filePath 지정
- 수신 파일: 메시지 카드에 📎 표시, 클릭 시 다운로드/미리보기(md, txt)

## 사용자 예상 질문 → 답변 포인트

- "친구 추가 어떻게 해?" → "상대방 URL을 알려주시면 제가 바로 신청할게요" (RequestPartnership). 대시보드 친구 탭에서도 가능.
- "메시지 어떻게 보내?" → "누구에게 뭐라고 보낼까요?" (SendToPartner). 대시보드에서 직접도 가능.
- "파일도 보낼 수 있어?" → 가능. "OO에게 이 파일 보내줘" 또는 대시보드 드래그 앤 드롭.
- "네트워크 설정이 뭐야?" → 외부 통신을 위한 설정. `network-setup.md` SafeRead 후 안내.
- "친구 목록 보려면?" → 대시보드 친구 탭. partners.json SafeRead로 확인도 가능.

## 관련 위치
- 대시보드: 헤더 '친구' 버튼
- 내 프로필: `history/external/partners.json`의 myProfile
- 동료 목록: `/api/external/partners`
- MCP 도구: SendToPartner, RequestPartnership, RotatePartnerToken
- 네트워크 설정: `config/guides/network-setup.md`
