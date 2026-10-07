import { groundSummary } from "./grounding";
import { HTTPError } from "ky";
import type { MeetingInput } from "./domain";
import { z } from "zod";
import type { SummaryData, TranscriptData } from "./domain";
import {
	render,
	ServiceError,
	Summary,
	Transcript,
	validateEvidence,
} from "./domain";
import type { Store } from "./store";
import type { SummaryRequest } from "./summarize";
export type Adapters = {
	readonly transcribe: (
		fileId: string,
		revision: string,
		meeting: MeetingInput,
	) => Promise<TranscriptData>;
	readonly summarize: (input: SummaryRequest) => Promise<SummaryData>;
	readonly deliver: ((id: string, markdown: string) => Promise<void>) | null;
};
export async function tick(store: Store, adapters: Adapters): Promise<void> {
	const job = store.claim();
	if (job) {
		try {
			const meeting = store.input(job);
			const transcript = job.transcript
				? Transcript.parse(JSON.parse(job.transcript))
				: (meeting.transcript ??
					(await adapters.transcribe(
						meeting.driveFileId ?? "",
						meeting.revision,
						meeting,
					)));
			store.checkpoint(job.id, JSON.stringify(transcript));
			const sources = store.search(
				meeting,
				transcript.map((s) => s.text).join(" "),
			);
			const summary = groundSummary(
				Summary.parse(
					await adapters.summarize({ meeting, transcript, sources }),
				),
				transcript,
				sources,
			);
			validateEvidence(summary, transcript, sources);
			const markdown = render({
				id: job.id,
				meeting,
				transcript,
				summary,
				sources,
			});
			store.db.transaction(() => {
				store.complete(job.id, {
					summary: JSON.stringify(summary),
					sources: JSON.stringify(sources),
					markdown,
				});
			})();
		} catch (error) {
			if (error instanceof z.ZodError)
				console.warn(
					JSON.stringify({
						event: "provider_validation_failed",
						issues: error.issues.map((i) => ({
							path: i.path,
							code: i.code,
							message: i.message,
						})),
					}),
				);
			store.fail(
				job,
				error instanceof ServiceError
					? error.code
					: error instanceof HTTPError && error.response.status === 404
						? "provider_model_unavailable"
						: error instanceof HTTPError && error.response.status === 429
							? "provider_quota_wait"
							: error instanceof HTTPError &&
									[401, 403].includes(error.response.status)
								? "provider_auth_required"
								: error instanceof z.ZodError
									? "invalid_provider_output"
									: "processing_failed",
			);
		}
	}
	const next = store.pendingDelivery();
	if (next?.markdown) {
		if (!adapters.deliver) {
			store.delivery(next.id, "disabled");
			return;
		}
		store.delivery(next.id, "sending");
		try {
			await adapters.deliver(next.id, next.markdown);
			store.delivery(next.id, "sent");
		} catch (error) {
			if (!(error instanceof Error)) throw error;
			store.delivery(next.id, "uncertain");
		}
	}
}
