# Schema and collaboration findings

- User explicitly selected Sonnet instead of Haiku for this continuation. Isolated INGESTIGER_MODEL=claude-sonnet-5; upstream pin and shared/default configs unchanged.
- CLI 2.1.263 rejects draft/2020-12 locally before inference. z.toJSONSchema(...,{target:'draft-7'}) supplies equivalent supported schema. Initial local failures had no stdout result; no costs inferred for them.
- Actual Sonnet structured_output returned evidence arrays and four valid needs. A harness parser initially required model on user tool-result messages; fixed to require it only when observing assistant messages. The exact captured CLI output was revalidated without another model call. No response content was edited.
- Four needs were manually compared with the original synthetic sentence and accepted as codex:synthetic-test. They preserve effective date, drafts only, human final execution, automatic ordering prohibition and unknown department. This is not a human business approval.
- Actual specialist transcript reports claude-opus-5, not merely its configured alias. It called unrelated WikiSearch (mandatory), all-knowledge search, four WikiRead calls and WikiHandoff(join_aggregate) to corpus-keeper. ACK job 5ea0d199-a53c-4351-a298-7329de586a72 is being monitored to actual completion.
