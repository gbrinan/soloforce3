# 아난다라(교육일정·정산 앱) 데이터 작업 가이드

아난다라는 mycrew-works/anandara에서 :13210으로 도는 별도 앱이다. **교육 일정 등록/조회 같은 데이터 작업은 코드 에이전트(dev-pm)에게 위임하지 말고, 아래 API를 직접 호출한다.** (과거 dev-pm 위임은 권한 문제로 전부 실패했다 — 2026-07-14 사고 기록)

## 절차 (지니가 Bash로 직접 실행)

1. SSO 토큰 발급:
```bash
TOKEN=$(curl -s http://127.0.0.1:3456/api/sso/issue-token | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).token||''))")
```

2-A. 교육 등록 (POST):
```bash
curl -s -X POST http://127.0.0.1:13210/api/apps/anandara/proxy/api/mycrew/educations -H "Content-Type: application/json" -d '{
  "ssoToken": "'$TOKEN'",
  "education": {
    "edu_date": "2026-08-28", "start_time": "13:00", "end_time": "17:00",
    "client_name": "고객사명", "topic": "과정명", "curriculum": "메모",
    "location": "장소", "is_seoul": false, "hourly_rate": 0
  }
}'
```
- 필수: edu_date(YYYY-MM-DD), start_time/end_time(HH:MM). 나머지 선택.
- 강의료를 모르면 hourly_rate 생략(0) — 앱에 "정보 입력 필요" 배지가 붙는다.
- 응답 201 {ok:true} = 성공. 409 conflict = 시간 충돌(기존 일정 목록이 옴 — 사용자에게 보고).

2-B. 월별 조회 (GET):
```bash
curl -s "http://127.0.0.1:13210/api/apps/anandara/proxy/api/mycrew/educations?ssoToken=$TOKEN&month=2026-09"
```

## 하드 룰
- 일정 수정/삭제/완료 처리는 API가 없다 — 사용자에게 "앱에서 직접" 안내한다.
- 벤더 수수료·정산 로직 변경 같은 **코드 작업**만 dev-pm에게 위임하되, cwd를 C:\mycrew\mycrew-works\anandara로 지정하고 dev-pm writePaths 제약을 사용자에게 먼저 알린다.
- 토큰·응답 원문을 로그·보고서에 통째로 붙이지 않는다 (건수·결과만).
