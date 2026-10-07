import { readFile, writeFile, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import ky from "ky";
import { z } from "zod";

const Result = z.object({
	markdown: z.string().min(1),
	ontology: z.object({ schema_version: z.literal(1) }).passthrough(),
	summary: z.object({
		summary: z.array(z.string()),
		reviewIssues: z.array(z.object({ message: z.string() })).optional(),
		background: z.string(),
		keyPoints: z.array(z.string()),
		actions: z.array(
			z.object({
				task: z.string(),
				owner: z.string().nullable(),
				due: z.string().nullable(),
			}),
		),
	}),
	transcript: z.array(
		z.object({
			start: z.number(),
			end: z.number(),
			speaker: z.string(),
			text: z.string(),
		}),
	),
});
const State = z.object({
	id: z.string().regex(/^[a-f0-9]{64}$/),
	status: z.enum(["queued", "running", "ready", "failed", "waiting"]),
	error: z.string().nullable().optional(),
});

export async function processWithMeetingMemory(input: {
	readonly token: string;
	readonly title: string;
	readonly recordingPath: string;
	readonly date: string;
	readonly provider: "groq" | "gemini";
	readonly jobId?: string;
	readonly onQueued: (id: string) => void;
}) {
	const base = new URL(
		process.env.MEETING_MEMORY_URL || "http://127.0.0.1:8787",
	);
	if (
		!["http:", "https:"].includes(base.protocol) ||
		base.username ||
		base.password
	)
		throw new Error("invalid_meeting_memory_url");
	if (
		base.protocol === "http:" &&
		!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
	)
		throw new Error("meeting_memory_https_required");
	const token = process.env.MEETING_MEMORY_TOKEN;
	if (!token) throw new Error("meeting_memory_token_required");
	const client = ky.create({
		prefix: base.href.replace(/\/$/, ""),
		headers: { Authorization: `Bearer ${token}` },
		retry: {
			limit: 5,
			methods: ["get"],
			retryOnTimeout: true,
			backoffLimit: 5000,
			maxRetryAfter: 10000,
		},
		timeout: 60000,
	});
	let state: z.infer<typeof State>;
	if (input.jobId) {
		const jobId = State.shape.id.parse(input.jobId);
		state = State.parse(await client.get(`v1/meetings/${jobId}`).json());
	} else {
		const bytes = await readFile(input.recordingPath);
		if (bytes.length > 200 * 1024 * 1024)
			throw new Error("meeting_memory_audio_limit_200mb");
		const form = new FormData();
		form.set(
			"file",
			new Blob([new Uint8Array(bytes)]),
			basename(input.recordingPath),
		);
		form.set(
			"metadata",
			JSON.stringify({
				project: "soloforce2",
				title: input.title,
				date: input.date,
				sourceId: input.token,
				revision: "1",
				transcriptionProvider: input.provider,
			}),
		);
		state = State.parse(await client.post("v1/uploads", { body: form }).json());
	}
	input.onQueued(state.id);
	const deadline = Date.now() + 90 * 60 * 1000;
	while (state.status === "queued" || state.status === "running") {
		if (Date.now() >= deadline)
			throw new Error("meeting_memory_timeout_job_preserved");
		await setTimeout(2000);
		state = State.parse(await client.get(`v1/meetings/${state.id}`).json());
	}
	if (state.status !== "ready")
		throw new Error(
			`meeting_memory_${state.status}:${state.error ?? "unknown"}`,
		);
	return Result.parse(
		await client.get(`v1/meetings/${state.id}/result`).json(),
	);
}

export async function saveMeetingMemoryArtifacts(
	directory: string,
	token: string,
	result: z.infer<typeof Result>,
): Promise<void> {
	if (!/^[a-f0-9]{32}$/.test(token)) throw new Error("invalid_meeting_token");
	for (const [extension, content] of [
		["md", result.markdown],
		["ontology.json", JSON.stringify(result.ontology, null, 2)],
	]) {
		const target = join(directory, `${token}.${extension}`);
		await writeFile(`${target}.tmp`, content, "utf8");
		await rename(`${target}.tmp`, target);
	}
}
