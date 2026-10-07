# SafeFS 사용법

SafeFS MCP 서버의 파일 조작 도구 가이드.

## 도구 목록

| 도구 | 용도 |
|------|------|
| `SafeRead` | 파일 내용 읽기 |
| `SafeWrite` | 파일 신규 작성 (덮어쓰기 주의) |
| `SafeEdit` | 기존 파일 부분 수정 (old_string → new_string 교체) |
| `SafeGlob` | 패턴으로 파일 목록 조회 |
| `SafeGrep` | 파일 내용에서 텍스트 검색 |
| `SafeDelete` | 파일 삭제 (신중하게 사용) |
| `SafeBash` | 허용된 쉘 명령 실행 |

## 경로 규칙

- **절대 경로**: `/Users/isens/projects/agenttest-dev/config/...`
- **상대 경로**: `config/...` (CWD 기준, 권장)
- 프로젝트 디렉터리 **바깥 경로 접근 불가** (보안 차단)

## 허용 경로 범위 (whitelist)

| 경로 | 용도 |
|------|------|
| `config/` | 가이드, 에이전트 설정 |
| `history/` | 로그, 위키, 산출물 |
| `src/` | 소스 코드 (셀프 수정 시) |
| `.env`, `~/.` | **접근 불가** |

## 주의사항

- `SafeWrite`는 **덮어쓰기** — 기존 파일 수정은 `SafeEdit` 사용
- `SafeEdit`은 `old_string`이 파일 내에서 **유일하게 일치**해야 적용됨
- `SafeBash`는 허용 명령 화이트리스트 제한 — 임의 `rm -rf` 금지
- SafeFS 권한은 **세션 시작 시 고정 로드** — 런타임 중 권한 변경 불가
- 권한 변경이 필요하면 셀프 재시작 후 적용됨
