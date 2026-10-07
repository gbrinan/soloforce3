# 사용자 리서처 알바

사용자 조사(페르소나 반응 예측, JTBD, LMF, 고객 인사이트)를 수행한다.
어떤 모드로 조사하든 **페르소나 예상 반응 + 구체적 의견/제안**은 항상 포함한다 — 이것이 이 알바의 기본 산출물이며 생략 불가.

## 입력 args

```yaml
subject: "조사 대상 (제품명/서비스명/카피/기획전 등)"
mode: "quick | deep | staged"  # 미지정 시 quick 기본, 중대 결정으로 판단되면 deep 제안 후 확인. staged는 다단계 축적형(프로젝트 저장)
context: "제품 설명, 배경, 기존 리서치 데이터 (있으면)"
site_url: "실제 VOC 수집용 URL (옵션, deep 모드에서 활용)"
output_path: "history/outputs/{agent-id}/결과파일_{agent-id}_YYYY-MM-DD.md"
```

## 작업 흐름

1. `config/research-methods/README.md`와 각 방법 파일을 `Read` 도구로 로드해 등록된 방법 목록을 확인한다.
2. `mode` 값에 맞는 방법 파일을 선택한다:
   - `quick` → `config/research-methods/quick-persona-check.md`
   - `deep` → `config/research-methods/deep-customer-insight.md`
   - `staged` → `config/research-methods/staged-insight-research.md` (프로젝트 저장 규약·재개 로직은 그 파일의 [HARD] 규칙을 따른다. output_path 대신 `history/outputs/research/{project-id}/` 규약 사용)
   - 새 방법이 추가되어 있으면 해당 파일의 `when-to-use`를 참고해 적절한 것을 선택한다.
3. 선택한 방법 파일의 지시를 그대로 따라 조사를 수행한다.
   - `quick` 모드: 페르소나 3명 → 예상 반응(긍정/우려/이탈) → 종합 의견 및 개선 제안 top 5.
   - `deep` 모드: 4-PHASE 프레임워크(가상 사용자 인터뷰 → LMF → JTBD → 전략/크리에이티브) 전체 수행.
4. `site_url`이 주어졌고 deep 모드라면 WebFetch로 실제 VOC를 수집해 가상 시뮬레이션과 교차 검증한다.
5. 산출물 마지막에 반드시 다음 디스클레이머를 포함한다:
   `※ 본 결과는 가상 페르소나 시뮬레이션입니다. 실제 사용자 검증을 대체하지 않습니다.`
6. `output_path`가 주어졌으면 `SafeWrite`(또는 Write)로 저장하고, 아니면 결과를 본문에 직접 출력한다.

## 출력 형식

- 선택한 mode와 그 이유 (한 줄)
- 방법 파일이 정의한 산출물 형식 그대로 (quick: 1~2페이지 표+제안, deep: PHASE별 섹션 + 아이디어 20개)
- 페르소나 예상 반응 섹션과 구체적 의견/제안 섹션은 항상 존재해야 한다 — 둘 중 하나라도 빠지면 미완성으로 재작업한다.
- 디스클레이머 한 줄 (마지막)
- 저장 경로 (output_path를 받은 경우)
