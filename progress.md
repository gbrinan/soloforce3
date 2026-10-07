# Verification evidence — 2026-09-09

- npm run build: PASS. Server and client TypeScript checks plus Vite production build. Existing large chunk warning remains; no frontend code changed. First 60-second shell timeout was rerun successfully with a longer command allowance.
- npm run test:meeting-memory: PASS. Actual local HTTP upload, explicit Gemini provider, persisted remote job ID, Markdown/ontology files, authorized reads, unauthorized 403 and quota error without fallback. Provider responses in this test are fixtures.
- services/meeting-memory: bun run check PASS; bun test PASS (18 tests, 51 assertions); bun run build PASS. Added authenticated combined-result route covered by real HTTP assertions.
- bun src/manual-qa.ts: PASS. Real local HTTP source ingestion, meeting submission, SQLite pipeline, Markdown and ontology reads, human-review transition and database reopen. Summary generation is explicitly synthetic in this QA script.
- Private recording and API credentials excluded from repository changes. No external Groq/Gemini request was made in this repository integration pass.
- Operational prerequisites: service process, matching service token and valid provider keys. Groq live credential validation remains unresolved from the earlier standalone test. Drive/GAS deployment and full live provider flow are not claimed complete.

- GitHub publication: implementation commit 61ea87d successfully pushed to codex/meeting-memory-integration. Main was not merged and no operating server was restarted.

## Operating deployment — 2026-09-09

- Main fast-forward merge and push: 1c345e896b76c44d8690259f3ecaf2eea69d64ad.
- Existing Ubuntu release updater preserved local Gmail overlays and completed npm build, meeting-memory 18 tests/51 assertions, adapter HTTP test, corpus tests, Google connection tests and Gmail tool regression.
- Soloforce2 and Meeting Memory systemd units are active and enabled; HTTP health checks pass. Canonical existing Groq and Gemini keys each returned HTTP 200; no keys copied into Git.
- Initial Bun launch path was corrected to the package-provided .bin/bun link. Original Downloads folder was unreadable from WSL; a private temporary copy enabled the authorized upload.
- Live recording upload accepted; Groq produced 271 segments ending at 1274.9199 seconds. Gemini summary was rejected by evidence/owner validation in all three attempts (invalid_action_evidence, unknown_owner, unknown_owner). No completed Markdown or ontology was falsely published. Transcription checkpoint remains for a later corrected retry.
- Operational health is verified, but full successful live generation is NOT verified. Automatic retries stopped at the configured cap. Requested human decision per workspace three-failure rule.

## Summary reliability repair

Captured real provider response reproduced failure deterministically: 6 proposed actions, 5 unsupported assignee labels, 2 quotations absent from every segment. Original validator failed; the grounded copy passed the unchanged validator with 4 evidenced actions, 3 unassigned owners, and 5 visible review issues. Four regression tests failed before the patch and passed after it. A resume regression failed with missing-recording ENOENT before the patch and passed afterward without uploading. No customer content or provider keys were placed in fixtures.

Final local verification before deployment: 25 tests/80 assertions PASS; server/client type checks and production build PASS; adapter resume HTTP test PASS. Only API-sized modules were added; no any/assertion escape hatches. Uncertain candidates remain explicit review data rather than asserted graph facts.

## Live repair acceptance — 2026-09-09 KST

- Main implementation d545e22c2c96933f471fdb0169707b61f29e147f deployed by the existing release updater; combined health passed and updater exited 0. Deployment checks included 25 service tests/80 assertions, bridge HTTP, corpus, Google readonly connection and Gmail regression checks.
- Retried the existing failed job using its persisted transcript, without audio re-upload or re-transcription. Actual Gemini response completed. Transcript hash unchanged across all 271 segments.
- Soloforce2 metadata resynchronized to ready with the same remote job ID and Groq engine; stale error cleared. Four grounded actions and two explicitly unverified proposals were preserved in their respective sections. The unchanged strict evidence validator passed all asserted data.
- Live Markdown: HTTP 200, 40,514 bytes, all four sections, collapsed transcript, unreviewed status. Ontology: HTTP 200, four Action entities and reviewed=false. HTML: HTTP 200 with visible review warning text. Private receipt is stored in the runtime state directory; no customer text or access token is committed.
- Remaining boundary: this verifies direct-upload processing and recovery. Google Drive/GAS installation and automatic folder detection are still separate infrastructure work. Provider outages/quota errors remain explicit errors; uncertain model content no longer fails the entire draft.

- Real headed Chromium QA PASS: warning text visible, four action items present, transcript initially collapsed and opens on click, no browser page errors. The bundled browser version was absent, so the installed Chromium executable was used. An initial text-length probe incorrectly counted only collapsed-page visible text; the corrected acceptance checks assert action count and actual transcript disclosure behavior.
- Cleanup: no production instrumentation was added. Temporary candidate JSON and local diagnostic journal are removed after verification; the runtime keeps only the normal meeting data and a private content-free verification receipt.

## Existing recording batch test — preflight
- Inventory: 22 records, 16 unique source paths, all source files exist. Selected five: WEBM 441.777s (Groq), M4A 2817.344s (Groq), WAV 60.719979s (Groq), previously failed WEBM 875.755s (Groq), WEBM 2780.986s (explicit Gemini, 44.8MB).
- Full ffmpeg decode to null passed for all five without decoder warnings; SHA-256 recorded privately. No original files or existing meeting outputs changed.
- Automatic approval review rejected the live batch runner before process creation because explicit consent for sending these recordings to Groq/Gemini and creating production results was required. No provider requests or test meetings were created. Awaiting that consent; no bypass attempted.
- Resume artifacts outside repository: outputs/meeting-memory-batch/{manifest.json,preflight.json,run.mjs}. Manifest contains private source paths; never commit. Run sequentially only after consent; reports are resumable by completed case and preserve existing results.

- User explicitly approved the five-recording external/provider batch and separate production output creation. Two preparation attempts stopped before network submission on Windows-to-WSL path conversion; explicit separator normalization corrected the runner. First production case submitted successfully; previous results remain intact.

## Existing recording batch — final acceptance
- Approved five-case run completed: four Groq cases ready, one Gemini case failed. All five originals (audio, original metadata, original HTML) retained matching hashes. Separate test records were created; no provider fallback or original overwrite occurred.
- Groq results: 96 / 618 / 10 / 129 transcript segments. Four cases passed strict evidence checks, four-section Markdown, ontology, actual HTTP and headed Chromium transcript disclosure checks with no page errors.
- Quality warning: the previously failed WEBM has nine segments overlapping >90% near-silence (-35dB, minimum 1s); repeated closing phrases suggest hallucination. No claim of word-level accuracy or exhaustive speech coverage.
- Gemini 46m21s/44.8MB: first two attempts gemini_output_incomplete; third processing_failed; terminal failed with no transcript checkpoint. App polling separately failed with a network error while the remote job remained queued/running. Both units active with NRestarts=0. A conditional request to hold a queued retry changed zero rows because the final attempt was already running; it then terminated normally at the retry cap. No further attempts made.
- Private report and artifacts: workspace outputs/meeting-memory-batch/테스트 결과.md, report.json, browser-qa.json, silence-audit.json and per-case Markdown/ontology. Contains customer-derived data; excluded from Git. Production source unchanged. Follow-up scope: silence-aware transcription, long-audio chunking, recoverable status polling and more specific provider error reporting.

## Audio reliability repair — local evidence
- Existing status helper failed the newly added HTTP 503 scenario before the change; after GET-only retries it passes 503 and forcibly dropped TCP connection cases without re-upload. A first test command timeout was rerun with adequate allowance and passed.
- New audio modules were absent in initial red run; after implementation all 31 tests/102 assertions pass, including an actual FFmpeg decode and local HTTP transcription fixture. Cache test resumes after failure without repeating the first provider call.
- Canonical Ubuntu FFmpeg prerequisite installed. Local original-audio planning: problematic WEBM becomes 9 parts/620.54 transmitted seconds (last part ends809.26s versus875.755s source); 46m21s WEBM becomes16 bounded parts. This is planning evidence only; live transcription acceptance still pending.

- Production deployment 015304140386c7fd89234cebdae0d9133772d6a0 passed updater regressions and health. Live Groq retest succeeded in49s with118 segments; original hashes unchanged, Markdown/ontology and browser disclosure pass. Near-silent overlap metric decreased9→3; repeated closing phrases decreased8→4. Remaining low-volume segments are not automatically declared false.
- Live Gemini segmented run completed its first chunk, then parked on provider_quota_wait with one completed Gemini chunk plus nine Groq chunks cached. This is an external quota limit; full long-Gemini success is not yet established.

- Final bounded Gemini resume again returned provider_quota_wait after15s; no additional chunks completed (9 Groq +1 Gemini cache files). It remains waiting, with no active retries. Full long-Gemini success is explicitly unverified; next operator can retry the same job after quota recovery.
- Final report is outputs/meeting-memory-retest/재시험 결과.md, with private per-case artifacts and original hash receipts outside Git. No raw customer content or keys entered source changes.

## Selective Gemini controls verification
- Added explicit Groq/Gemini recording actions and provider-specific title dialog copy in ko/en/ja; both modes disclose Gemini summary quota. API omission now means Groq, regardless of the previous environment default.
- Full production build and meeting-memory HTTP adapter regression passed. Browser drove the actual MeetingDrawer/Dialog components at 375/768/1280px: both providers sent correct explicit payloads, cancel sent nothing, pending and existing processing disabled both buttons. Provider calls: zero (intercepted fixture requests).
- Initial full-shell browser attempt was blocked by intermittent local WSL availability and startup/auth dependencies. Switched to an isolated production bundle of the real components; all interaction assertions passed. Browser cleanup initially exceeded command timeout after assertions; bounded cleanup rerun exited 0. Temporary harness source removed from product tree; private evidence is outside Git under outputs/meeting-memory-retest/button-*.
- Existing large client chunk warning remains; no unrelated app optimization or dev dependency changes were introduced for these controls.

Independent functional review passed. Visual review found Korean word splits in dialog descriptions; changed the shared description wrapping to keep-all with anywhere overflow for long unbroken strings. Regenerated all six captures and re-ran interaction QA successfully; final production build passed.

Selective Gemini deployed revision: b36e39614fd31ed1587a1574f2f7fd9f95f50252. Updater exited 0 after service tests, adapter, corpus, Google read-only and Project Drive regression checks. Preserved all four existing runtime overlays. Warmed app /api/health and sidecar /health returned 200; deployed index-BTEMUQmx.js contains meeting.geminiSummarizeBtn. Final independent visual/CJK review PASS on all six regenerated screenshots. Full-shell browser navigation did not reach the meeting panel within timeout; stopped that approach, no real provider requests. Component browser assertions and deployment verification are the proven acceptance scope.
