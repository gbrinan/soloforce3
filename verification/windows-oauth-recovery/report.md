# Windows OAuth 만료 복구 검증

## TL;DR

장기 실행 중이던 WSL 서비스의 Claude PTY가 만료된 OAuth 상태를 계속 사용했다. 서비스가 유휴 상태임을 확인한 뒤 같은 경로와 포트로 재시작했고, 실제 `claude-sonnet-5` 직원 호출에서 `AUTH_RECOVERED`와 비영(非零) 사용량을 확인했다. 소스에는 PTY 출력의 OAuth 만료를 감지해 세션을 새로 만들고 한 번만 재시도하는 복구를 추가했다.

## 환경과 즉시 복구

- 서비스: WSL2 Ubuntu, `127.0.0.1:3456`, Linux Node `v22.22.3`, Claude CLI `2.1.263`
- 재시작 전 활성 작업: 0건
- 재시작 전후 `WORKSPACE_ROOT=/mnt/c/mycrew`, `MYCREW_HOME=/mnt/c/mycrew/mycrew-program`, `CLAUDE_PATH=/home/anan/.local/bin/claude`, `PORT=3456` 유지
- 인증 파일이나 비밀값은 복사·출력·변경하지 않았다.
- 재시작 후 `/api/health`: HTTP 200, `{"ok":true,"service":"mycrew-host"}`

## 실제 모델 호출

- 직원: `ax-scout` (`AX정찰`)
- 모델 ID: `claude-sonnet-5`
- job ID: `66d755f1-812c-48ee-a5d4-a52d6bf6b9d2`
- task ID: `14af834b-24b8-45ab-8e2b-386dd8264a61`
- Claude session ID: `fd14ea55-2b32-43b8-9036-c416f440a83a`
- 실제 결과: `AUTH_RECOVERED`
- 사용량: 15 tokens, USD 0.190082
- 잡 상태는 `outputs_missing`이다. 인증이나 모델 호출 실패가 아니라 검증 프롬프트가 직원 보고 형식을 생략한 결과이며, 로그에는 exit 0과 실제 결과가 남았다.

### 후속 정정

위 `outputs_missing` 상태와 실패 알림 자체가 별도 결함이었다. API의 `skipOutput`은 프롬프트 문구에만 반영되고 Job에 저장되지 않아, 분류기가 모든 성공 응답에 구조화 보고서를 요구했다. `skipOutput=true`를 Job에 보존하고, 치명 오류 검사를 통과한 텍스트 전용 작업은 일반 텍스트 응답만으로 완료 처리하도록 수정했다. 따라서 위 Job은 인증과 모델 실행 관점에서 성공이며, 새 버전에서는 같은 응답이 `completed`로 분류된다.

현재 소스를 별도 Windows 격리 서버 `127.0.0.1:3487`에서 실행해 같은 조건을 재검증했다.

- 모델 ID: `claude-sonnet-5`
- 직원: `corpus-keeper`
- job ID: `83820107-8abb-41ea-9e23-0a74a7b5026f`
- task ID: `22cbcdc9-7b8f-4756-9ecb-876a64c35e8d`
- 결과: `AUTH_RECOVERED`
- 최종 상태: `completed`
- 사용량: 15 tokens, USD 0.334126
- 외부 조회·파일 변경·위임: 없음

## 코드 복구

- ANSI가 포함된 PTY 출력에서도 `401 OAuth access token has expired`를 감지한다.
- 응답 대기 중인 PTY가 이 오류를 출력하면 즉시 대기를 실패시켜 30분 타임아웃을 피한다.
- 상주 직원과 Genie 채팅은 PTY 및 Claude session을 새로 만든 뒤 같은 요청을 한 번만 재시도한다.
- 재시도 뒤에도 만료 응답이면 성공으로 처리하지 않고 명시적으로 실패한다.

## 검증

- Red: `npx tsx scripts/claude-auth-retry-test.ts`는 구현 전 `does not provide an export named 'isOAuthExpiredError'`로 종료 코드 1이었다.
- Green: `npm.cmd run test:claude-auth-retry` PASS.
- `npm.cmd run build` PASS: 서버 TypeScript, 클라이언트 TypeScript, Vite production build.
- `npm.cmd test`는 새 OAuth 회귀를 포함해 앞선 테스트를 통과했으나, 미프로비저닝 저장소에 `history/agents.json`이 없어 기존 `route-keyword-collision-test`가 23건 실패했다. OAuth 변경과 무관한 기존 fixture 의존성이라 검사나 테스트를 완화하지 않았다.

## 판정과 한계

- 현재 인증 복구: 통과. 재시작된 운영 경로에서 실제 Sonnet 호출과 비영 사용량 확인.
- 자동 재발 방지 코드: 단위 회귀와 production build 통과.
- 만료 시점의 실제 자동 재시도: 미검증. 유효 토큰을 임의 만료시키거나 인증 파일을 훼손하지 않았기 때문에 실제 401을 다시 만들지 않았다.
- 현재 운영 서비스는 기존 설치 릴리스다. 이번 소스 수정은 사용자의 기존 지시에 따라 배포하지 않았으므로 자동 복구는 다음 정상 릴리스 반영 뒤 운영에 적용된다.

반대 관점에서는 서비스 재시작만으로 당장 증상이 사라졌으므로 코드 변경이 과할 수 있다. 그러나 기존 구현은 OAuth 401을 PTY 화면에만 남긴 채 최대 응답 타임아웃까지 기다릴 수 있고 재인증 뒤에도 같은 상주 세션을 재사용한다. 제한된 한 번의 세션 재생성은 이 확인된 장기 실행 상태를 직접 제거하며 무한 재시도를 만들지 않는다.
