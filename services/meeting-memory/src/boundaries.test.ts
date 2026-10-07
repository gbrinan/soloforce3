import { expect, test } from "bun:test";
import { Config } from "./config";
import { Summary } from "./domain";
import { tick } from "./pipeline";
import { reviewMeeting } from "./review";
import { publishToSoloforce } from "./soloforce";
import { Store } from "./store";
import { transcribe } from "./transcribe";

const meeting = {
	project: "project",
	title: "문서 회의",
	date: "2026-09-08",
	sourceId: "recording",
	revision: "1",
	transcript: [
		{ start: 0, end: 1, speaker: "미상", text: "문서 작성이 필요하다." },
	],
};
const summary = Summary.parse({
	summary: ["문서 작성이 필요하다."],
	background: "준비 회의",
	keyPoints: [],
	issues: [],
	retrospective: [],
	actions: [],
	references: [],
});
test("only reviewed meetings become historical search sources", async () => {
	// Given
	const store = new Store(":memory:");
	const job = store.enqueue(meeting);
	await tick(store, {
		transcribe: async () => meeting.transcript,
		summarize: async () => summary,
		deliver: null,
	});
	expect(store.search({ ...meeting, sourceId: "next" }, "문서")).toHaveLength(
		0,
	);
	// When
	reviewMeeting(store, job.id, "https://meetings.example.org");
	// Then
	expect(store.search({ ...meeting, sourceId: "next" }, "문서")).toHaveLength(
		1,
	);
	store.db.close();
});
test("Whisper adapter sends multipart audio and parses real HTTP response", async () => {
	// Given
	let fileReceived = false;
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(req) {
			const form = await req.formData();
			fileReceived =
				form.get("file") instanceof File &&
				form.get("response_format") === "verbose_json";
			return Response.json({
				segments: [{ start: 0, end: 1, text: "테스트 발화" }],
			});
		},
	});
	try {
		const cfg = Config.parse({
			SERVICE_TOKEN: "test-token-123456789012345",
			TRANSCRIBER: "whisper",
			WHISPER_URL: new URL("/v1/audio/transcriptions", server.url).href,
		});
		// When
		const result = await transcribe(
			{
				blob: new Blob(["synthetic fixture"], { type: "audio/wav" }),
				name: "test.wav",
			},
			cfg,
		);
		// Then
		expect(fileReceived).toBe(true);
		expect(result[0]?.speaker).toBe("화자 미상");
	} finally {
		server.stop(true);
	}
});
test("Soloforce publish uses verified multipart route and same origin header", async () => {
	// Given
	let accepted = false;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const form = await req.formData();
			accepted =
				new URL(req.url).pathname === "/api/corpus/import/local" &&
				req.headers.get("origin") === new URL(req.url).origin &&
				form.get("file") instanceof File;
			return Response.json({ source: { id: "fixture" } });
		},
	});
	try {
		// When
		await publishToSoloforce({
			baseUrl: server.url.href,
			id: "fixture",
			markdown: "# 가상 회의",
			project: "project",
		});
		// Then
		expect(accepted).toBe(true);
	} finally {
		server.stop(true);
	}
});
test("worker stops retrying at three and crash recovery marks uncertain delivery", async () => {
	// Given
	const store = new Store(":memory:");
	store.enqueue(meeting);
	const adapters = {
		transcribe: async () => meeting.transcript,
		summarize: async () => {
			throw new Error("provider failure");
		},
		deliver: null,
	};
	// When
	for (let i = 0; i < 3; i++) {
		await tick(store, adapters);
		store.db.exec("UPDATE jobs SET next_at=0");
	}
	// Then
	expect(store.list()[0]?.status).toBe("failed");
	expect(store.claim()).toBeNull();
	store.db.exec("UPDATE jobs SET delivery='sending'");
	store.recover();
	expect(store.list()[0]?.delivery).toBe("uncertain");
	store.db.close();
});
