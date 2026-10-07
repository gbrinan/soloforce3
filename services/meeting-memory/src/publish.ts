import { z } from "zod";
import { ServiceError } from "./domain";
import { http } from "./http";
import { PublishArgs, publishToSoloforce } from "./soloforce";

const cfg = PublishArgs.parse(process.env);
const id = z
	.string()
	.regex(/^[a-f0-9]{64}$/)
	.parse(process.argv[2]);
const headers = { Authorization: `Bearer ${cfg.SERVICE_TOKEN}` };
const base = new URL(`/v1/meetings/${id}`, cfg.MEETING_SERVICE_URL);
const state = z
	.object({ reviewed: z.boolean(), status: z.string() })
	.parse(await http.get(base, { headers }).json());
if (!state.reviewed || state.status !== "ready")
	throw new ServiceError("human_review_required");
const markdown = await http.get(`${base}/markdown`, { headers }).text();
const ontology = z
	.object({ meeting: z.object({ project: z.string() }) })
	.parse(await http.get(`${base}/ontology`, { headers }).json());
await publishToSoloforce({
	baseUrl: cfg.SOLOFORCE_URL,
	id,
	markdown,
	project: ontology.meeting.project,
});
console.info("Reviewed meeting imported into Soloforce2 corpus.");
