import { ServiceError, Source } from "./domain";
import type { Store } from "./store";
export function reviewMeeting(store: Store, id: string, origin: string): void {
	const job = store.get(id);
	if (job?.status !== "ready" || !job.markdown)
		throw new ServiceError("not_ready");
	const meeting = store.input(job);
	const source = Source.parse({
		id: job.id,
		project: meeting.project,
		title: meeting.title,
		date: meeting.date,
		uri: `${origin}/v1/meetings/${job.id}/markdown`,
		text: (job.markdown.split("## 4. 전문")[0] ?? job.markdown).replace(
			"review_status: unreviewed",
			"review_status: reviewed",
		),
	});
	store.db.transaction(() => {
		store.review(job.id);
		store.putSource(source);
	})();
}
