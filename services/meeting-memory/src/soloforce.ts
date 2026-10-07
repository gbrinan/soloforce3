import { z } from "zod";
import { ServiceError } from "./domain";
import { http } from "./http";
export async function publishToSoloforce(input: {
	readonly baseUrl: string;
	readonly id: string;
	readonly markdown: string;
	readonly project: string;
}): Promise<unknown> {
	const base = new URL(input.baseUrl);
	if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
		throw new ServiceError("soloforce_local_origin_required");
	const form = new FormData();
	form.set(
		"file",
		new Blob([input.markdown], { type: "text/markdown" }),
		`meeting-${input.id}.md`,
	);
	form.set(
		"labels",
		JSON.stringify([`프로젝트:${input.project}`, "종류:회의록"]),
	);
	return http
		.post(new URL("/api/corpus/import/local", base), {
			headers: { Origin: base.origin },
			body: form,
			retry: 0,
		})
		.json();
}
export const PublishArgs = z.object({
	MEETING_SERVICE_URL: z.string().url().default("http://127.0.0.1:8787"),
	SERVICE_TOKEN: z.string().min(24),
	SOLOFORCE_URL: z.string().url().default("http://127.0.0.1:3456"),
});
