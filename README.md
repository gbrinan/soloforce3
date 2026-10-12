# SoloForce3

**혼자 일해도, 팀처럼.** 자료를 모으고, AI 직원에게 일을 나누고, 결과를 검토하는 개인용 AI 업무 공간입니다.

SoloForce3는 MyCrew 기반의 개발 프로젝트입니다. 현재 앱과 패키지에는 MyCrew 이름이 함께 표시됩니다. 브라우저 대시보드와 로컬 서버를 사용하며, 실제 AI 작업은 Claude Code CLI로 실행합니다.

[소개 페이지](site/index.html) · [설치·이용안내](site/guide.html) · [사용자 매뉴얼](README-USER.md) · [개발·운영 문서](README-DEVELOPMENT.md)

> **현재 배포 상태:** 구현 코드는 `cycle4/v0` 브랜치에 있습니다. 기본 `main`과 다릅니다. 이 저장소의 GitHub Releases에는 설치 패키지가 등록되어 있지 않아 아래 소스 설치를 사용합니다. 소개 페이지는 HTML 파일이며, GitHub 파일 화면에서 직접 실행되지는 않습니다.

## 어떤 일을 맡길 수 있나요?

| 하고 싶은 일 | 제공하는 흐름 | 준비할 것 |
| --- | --- | --- |
| 조사·개발 일을 나누기 | 비서와 대화 → 직원에게 위임 → 진행과 산출물 확인 | Claude Code 로그인 |
| 자료를 모아 다시 찾기 | 로컬 자료 접수·분류·검색, 선택적 Drive·Notion 연결 | 외부 자료는 별도 계정·권한 설정 |
| 근거를 지식으로 정리하기 | IngesTiger Wiki 분석 후보 → 사람 검토 → 정본 반영 | Python 3 및 Wiki 설정 |
| 회의 내용을 남기기 | 녹음 전사 → 요약 → 구조화된 회의 기록 | 전사·요약 제공자 설정 |
| 작업과 사용량 확인하기 | 업무·직원·산출물·비용 화면 | 사용 중인 계정과 제공자 과금 확인 |

자료 수집 범위는 [코퍼스 안내](config/corpus/README.md), 지식 검토는 [Wiki 안내](config/wiki/README.md), 회의 처리는 [회의록 안내](docs/meeting-memory.md)를 확인하세요. 앱은 [레지스트리](src/server/app-registry.ts)에 등록되어 있어도 설치 파일·계정·환경 설정이 따로 필요할 수 있습니다.

## 처음 시작하기

Git, Node.js/npm, 로그인한 Claude Code CLI가 필요합니다. Node 선언 범위는 [package.json](package.json)의 `engines`가 정본이며, 자료 수집까지 사용할 경우 기존 검증 환경에 맞춰 **Node 24**를 권장합니다. Wiki 후보 기능은 Python 3이 추가로 필요합니다.

새 폴더에 설치하는 명령입니다. Windows PowerShell에서는 `npm` 대신 `npm.cmd`를 사용할 수 있습니다.

```sh
git clone --branch cycle4/v0 https://github.com/gbrinan/soloforce3.git
cd soloforce3
npm ci
npm run build
npm start
```

1. Claude Code를 [공식 설치 안내](https://code.claude.com/docs/en/setup)에 따라 준비하고 `claude --version`과 로그인을 확인합니다.
2. 위 명령으로 의존성을 설치하고 웹 화면을 빌드합니다.
3. 브라우저에서 기본 주소 `http://localhost:3456`을 엽니다. 포트를 변경했다면 해당 주소를 사용합니다.
4. 초기 화면의 이름·비서·직원 설정을 마친 뒤 “새 파일을 만들지 말고 이번 작업의 계획을 먼저 정리해줘”라고 요청해 보세요.
5. 진행 상황과 산출물을 확인하고, 필요한 승인 요청은 화면의 승인 버튼으로 처리합니다.

기존 설치를 업데이트할 때는 위 명령을 다시 실행하지 말고 [Windows 기존 설치 안내](README-WINDOWS.md#update-existing)를 먼저 읽으세요. 해당 문서의 Soloforce2 경로·브랜치 예시는 현재 설치에 맞게 확인해야 합니다. 기존 `.env`와 개인 자료를 보존하세요.

## 비용과 데이터

- Claude Code 구독 또는 API 이용 비용은 별도입니다. 이 저장소는 Claude 이용권을 제공하지 않습니다. 최신 조건은 [Claude Code 공식 문서](https://code.claude.com/docs/en/overview)를 확인하세요.
- 회의 전사·요약, 외부 앱과 연결 서비스는 각각 추가 계정·API 비용이 발생할 수 있습니다. SoloForce3 자체의 유료 판매 요금은 이 문서에서 정하지 않습니다.
- 로컬에서 실행하더라도 AI 요청에 포함된 대화·파일 내용은 선택한 외부 제공자로 전송될 수 있습니다. “로컬 실행”은 “모든 데이터가 오프라인에만 남음”을 뜻하지 않습니다.
- 파일 접근은 권한 모드와 허용 범위에 따라 달라집니다. 처음에는 제한 모드로 시작하고, 승인 대상을 읽은 뒤 허용하세요.
- 시간 기반 자동 실행은 운영 환경의 외부 스케줄러 설정을 확인해야 합니다. 앱 실행만으로 모든 예약이 자동 수행된다고 보장하지 않습니다.

## 더 알아보기

- [설정·환경변수 정본](.env.example)
- [사용자 매뉴얼](README-USER.md): 대화, 업무, 직원, 산출물, 승인
- [개발·운영 문서](README-DEVELOPMENT.md): 아키텍처, 테스트, 외부 접속, 스케줄 운영
- [Windows 안내](README-WINDOWS.md) · [소스 배포 안내](README-DISTRIBUTION.md)
- [문제 제보](https://github.com/gbrinan/soloforce3/issues): OS, Node 버전, 실행 단계와 오류를 남겨 주세요. 비밀키·토큰·개인 문서는 제외합니다.

## 프로젝트와 참고 자료

SoloForce3는 Soloforce2의 후속 개발 저장소이며 MyCrew 기반 구현을 이어갑니다. 기존 구현 및 운영 이력은 [CLAUDE.md](CLAUDE.md)를 참고하세요. 구성 요소의 사용·재배포 조건은 각각의 라이선스를 확인해야 합니다.

소개 구성은 [MyCrew 홈](https://store.dooitspace.com/)과 [이용안내](https://store.dooitspace.com/guide)를 참고했습니다. 두잇스페이스의 공식 배포 사이트나 동일 제품으로 표시하지 않으며, 이미지·소개 문구를 복제하지 않습니다.
