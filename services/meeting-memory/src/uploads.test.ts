import { expect, test } from "bun:test";
import { createApp } from "./app";
import { Store } from "./store";
import { loadUpload } from "./uploads";
import { tick } from "./pipeline";
import { http } from "./http";
const token = "upload-test-token-1234567890";
const metadata = {
	project: "p",
	title: "회의",
	date: "2026-09-09",
	sourceId: "r",
	revision: "1",
	transcriptionProvider: "gemini",
};
function request(fields: unknown, bytes = "audio fixture"): Request {
	const form = new FormData();
	form.set("file", new File([bytes], "recording.m4a", { type: "audio/mp4" }));
	form.set("metadata", JSON.stringify(fields));
	return new Request("http://localhost/v1/uploads", {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
		body: form,
	});
}
test("multipart upload persists bytes, selects provider, deduplicates and rejects changed recording", async () => {
	const store = new Store(":memory:");
	const app = createApp(store, token);
	try {
		expect((await app.fetch(request(metadata))).status).toBe(202);
		expect((await app.fetch(request(metadata))).status).toBe(202);
		expect((await app.fetch(request(metadata, "different"))).status).toBe(409);
		const job = store.list()[0];
		if (!job) throw new Error("job missing");
		const meeting = store.input(job);
		if (!meeting.uploadId) throw new Error("upload missing");
		expect(await loadUpload(store, meeting.uploadId).blob.text()).toBe(
			"audio fixture",
		);
		let provider: string | undefined;
		await tick(store, {
			transcribe: async (_id, _revision, input) => {
				provider = input.transcriptionProvider;
				return [{ start: 0, end: 1, speaker: "미상", text: "회의 종료" }];
			},
			summarize: async () => ({
				summary: ["종료"],
				background: "회의",
				keyPoints: [],
				issues: [],
				retrospective: [],
				actions: [],
				references: [],
			}),
			deliver: null,
		});
		expect(provider).toBe("gemini");
		expect(store.get(job.id)?.status).toBe("ready");
		expect(store.get(job.id)?.markdown).toContain("<details>");
	} finally {
		store.db.close();
	}
});
test("upload rejects competing input modes and requires authentication", async () => {
	const store = new Store(":memory:");
	const app = createApp(store, token);
	try {
		expect(
			(await app.fetch(request({ ...metadata, driveFileId: "x" }))).status,
		).toBe(400);
		expect((await app.request("/v1/uploads", { method: "POST" })).status).toBe(
			401,
		);
		expect(store.list()).toHaveLength(0);
	} finally {
		store.db.close();
	}
});
test("provider quota failure parks job and retains transcription checkpoint", async () => {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response("quota", { status: 429 }),
	});
	const store = new Store(":memory:");
	try {
		const job = store.enqueue({
			...metadata,
			transcriptionProvider: "groq",
			transcript: [{ start: 0, end: 1, speaker: "미상", text: "종료" }],
		});
		await tick(store, {
			transcribe: async () => {
				throw new Error("must not transcribe");
			},
			summarize: async () => {
				await http.post(server.url);
				throw new Error("expected quota rejection");
			},
			deliver: null,
		});
		expect(store.get(job.id)?.error).toBe("provider_quota_wait");
		expect(store.get(job.id)?.status).toBe("waiting");
		expect(store.get(job.id)?.transcript).not.toBeNull();
		expect(store.claim()).toBeNull();
	} finally {
		server.stop(true);
		store.db.close();
	}
});
