# Integration findings

기존 회의 경로는 src/server/meetings.ts와 src/server/routes.ts이며 HTML 출력 및 목록 메타데이터를 이미 관리한다. 새 서비스 호출은 이 처리 함수에서 선택하고 기존 렌더러를 재사용한다. 자료실은 corpus 모듈이 담당하므로 검수 전 초안을 자동으로 자료실 검색에 넣지 않는다.

독립 Bun 서비스는 services/meeting-memory에 포함했다. Soloforce2는 Node 및 ky 2를 사용하여 HTTP 경계로 연결한다. 별도 프로세스는 운영 설정이 늘어나는 단점이 있지만 독립 사용과 기존 Node 런타임 유지라는 요구를 충족한다. SQLite 파일을 직접 공유하는 방법은 런타임 결합과 검수 정책 우회 위험 때문에 선택하지 않았다.

추가 운영 제약은 docs/meeting-memory.md가 정본이다. 이번 통합은 기존 구현의 이동·연결이며 새로운 공급자 성능 우위를 주장하지 않는다.

## Repeated validation failure: confirmed mechanism
A real Gemini candidate contained 6 actions; 5 used an inferred assignee absent from the transcript; 2 quotations matched no single source segment. All 271 transcription segments had the same unidentified speaker label. Exact validation therefore correctly rejected the candidate, but incorrectly made the whole artifact unavailable. Repeating the same model request provided no correction mechanism. The fix separates unsupported proposals into explicit review issues, clears unsupported owners, and repairs an index only on a unique exact quotation match. The strict validator still checks every published action and relation. Tradeoff: a draft can contain unresolved items; these remain visible and never create asserted action/assignment/reference graph links.

## Existing-recording batch inventory
22 existing meeting records refer to 16 recording paths, including duplicates and older failed records. All 16 source files exist from Windows. Several stored paths use Windows drive letters with repeated separators, while production runs on WSL. Seven files exceed the Groq 25,000,000-byte guard; selected large-file test explicitly uses Gemini rather than triggering fallback.

## Live batch findings
Four Groq cases completed through production (WEBM 7m22s, M4A 46m57s, WAV 1m01s, previously failed WEBM 14m36s), with original audio/metadata/HTML hashes unchanged. Browser disclosure checks passed. Evidence checks prove consistency with the generated transcript, not accuracy against the audio. The previously failed sample contains repeated closing phrases over near-silence: nine segments overlap >90% with intervals detected below -35dB for >=1s. This is a quality warning, not a human-verified word error rate. The 46m21s Gemini case returned gemini_output_incomplete before a transcript checkpoint; final retry result pending. Current error mapping does not expose the provider finish reason, so token truncation is a hypothesis rather than a confirmed cause.

Final Gemini outcome: three attempts ended failed with no transcript checkpoint; final stored code processing_failed after two gemini_output_incomplete observations. Application polling independently ended in a network error before the service job finished. No service restart was observed. The five-case functional result is 4/5; one functional success has a separate audio-grounding warning.

## Post-fix live outcome
Audio filtering/chunking reduced the observed near-silent overlap metric9→3 and the Groq record completed. Gemini now successfully produced one bounded chunk before an external quota response blocked the remaining15; one delayed resume returned the same quota condition. This does not establish whole-recording Gemini accuracy or completion. Quota recovery is the remaining external prerequisite; cached progress is retained.

## Selective Gemini transcription
The existing drawer omits transcriptionProvider; the API can select Gemini from an environment default. Both provider modes still use Gemini for summary. Explicit per-recording buttons and an always-Groq omitted API default make transcription opt-in without implying summaries avoid Google quota. Reuse meetingBtn and the existing title dialog; no new component library is needed.
