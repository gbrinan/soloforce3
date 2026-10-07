# Soloforce2와 함께 사용

연동 대상은 https://github.com/gbrinan/soloforce2 이다. 검수된 회의록의 자료실 가져오기는 기존 `/api/corpus/import/local` 계약을 사용한다. 기존 회의 화면에서 직접 생성하는 연결 설정은 [저장소 설치 안내](../../../docs/meeting-memory.md)를 따른다. 회의록 서비스는 독립 프로세스로 실행한다.

1. `/v1/meetings/{id}/markdown`과 `/ontology`를 읽고 담당자·기한·근거를 확인한다.
2. 문제가 있으면 원문/샘플/과거 자료를 수정하여 새 revision으로 다시 생성한다.
3. 확인 완료 후 `POST /v1/meetings/{id}/review`를 호출한다. 검수된 회의록만 다음 회의의 검색 근거로 등록한다.
4. Soloforce2가 같은 컴퓨터의 로컬 모드에서 실행 중일 때:

```sh
# SERVICE_TOKEN, 선택적으로 MEETING_SERVICE_URL / SOLOFORCE_URL을 설정
bun src/publish.ts <meeting-id>
```

이 도구는 검수 상태를 확인하고 Markdown을 Soloforce2 자료실에 가져온다. 동일 파일명은 기존 corpus의 버전 규칙을 따른다. 프로젝트 라벨을 함께 전달한다. SSO 활성 설치에서는 서버가 세션을 요구하므로 이 CLI는 403을 반환할 수 있다. 그 경우 로그인한 Soloforce2의 ‘자료 가져오기’에서 내려받은 Markdown을 등록한다. 인증 우회는 하지 않는다.

에이전트는 `/openapi.json`을 읽어 직접 등록·조회할 수 있다. 기존 온톨로지 그래프 DB에 대한 직접 동기화는 포함하지 않는다. `/ontology`의 엔티티와 관계 JSON을 소비한다. 사람 엔티티는 프로젝트 안의 이름 기준이며 동명이인 식별은 사람 검수가 필요하다.

[기존 corpus 계약](https://github.com/gbrinan/soloforce2/blob/main/src/server/corpus/routes.ts), [라우트 mount](https://github.com/gbrinan/soloforce2/blob/main/src/server/create-server-app.ts), [자료실 사용법](https://github.com/gbrinan/soloforce2/blob/main/config/corpus/README.md).
