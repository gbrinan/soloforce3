# Meeting Memory integration

1. Completed: standalone service sources and existing meeting processing integration, excluding private data/secrets.
2. Completed: owner-authenticated Markdown/ontology routes, API provider selection and installation documentation.
3. Completed: build, 18 service tests, HTTP surface QA and diff inspection. Evidence: progress.md.
4. Completed: published implementation commit 61ea87d on origin/codex/meeting-memory-integration. Main and runtime deployment remain unchanged.

Private recordings and keys remain outside Git. Existing meeting data is preserved. See docs/meeting-memory.md for installation and operational limitations.

## Operating deployment

1. Completed: identified Ubuntu soloforce2.service, release updater, canonical key file and existing local Gmail overlays.
2. Completed: fast-forwarded main to 1c345e8; canonical Groq/Gemini keys both returned HTTP 200. Installed sidecar and updated release hooks.
3. Resolved by the repair below: initial live summary failed three attempts (invalid_action_evidence, unknown_owner, unknown_owner); the existing recording is now recovered.

## Repeated summary failure repair
1. Completed: captured real candidate; reproduced 5 unsupported owners and 2 unmatched quotations.
2. Completed: content grounding plus visible review issues; 25 tests/80 assertions and resume-without-upload HTTP check pass.
3. Completed: deployed d545e22; recovered the existing failed recording with unchanged 271-segment transcript. Live Markdown, ontology and HTML passed; 4 actions plus 2 review issues stored as an unreviewed draft. See progress.md.

## Existing recordings live batch test
1. Completed: inventory 22 records, 16 unique recording paths; all files exist.
2. Completed: approved five-recording production tests executed. Four Groq successes; one Gemini terminal failure after three attempts. No additional retries.
3. Completed: original hashes preserved; four successful result pages verified in Chromium. Report records one near-silence quality warning, long-Gemini failure and status-polling failure. These limitations remain follow-up work, not passing quality claims.

## Audio reliability implementation
1. Completed: red/green regression for transient HTTP failure; new silence/chunk/cache tests and actual FFmpeg HTTP-provider fixture pass.
2. Completed: 31 service tests/102 assertions, dropped-connection adapter tests and full production build pass; implementation commits pushed.
3. Completed with external limitation: 0153041 deployed and health passed. Groq retest and browser passed with original hashes unchanged; near-silent overlap9→3. Gemini completed one chunk then parked on quota, including one bounded resume. Full Gemini completion remains blocked on external quota; no further calls active.

## Selective Gemini transcription
1. Completed: explicit Groq/Gemini action buttons, quota copy and Groq API default.
2. Completed: production build, adapter regression and real-component browser QA at 375/768/1280px with zero provider calls.
3. Completed: functional and final visual reviews passed; b36e396 published/deployed with preserved overlays. Both health endpoints returned 200 and deployed JS contains the provider controls. Full-shell browser navigation remains unverified due local startup/access behavior; actual-component UI QA passed.
