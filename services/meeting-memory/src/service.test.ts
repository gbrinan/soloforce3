import { expect, test } from "bun:test";
import { createApp } from "./app";
import { render, type SummaryData, validateEvidence } from "./domain";
import { graph } from "./ontology";
import { tick } from "./pipeline";
import { Store } from "./store";

const input = {
	project: "demo",
	title: "출시 회의",
	date: "2026-09-08",
	sourceId: "audio1",
	revision: "1",
	transcript: [
		{
			start: 0,
			end: 10,
			speaker: "민수",
			text: "제가 배포 문서를 작성하겠습니다.",
		},
	],
};
const summary: SummaryData = {
	background: "출시 준비를 논의했다.",
	keyPoints: ["고객사 검토 후 배포일을 결정한다."],
	issues: ["기한은 정하지 않았다."],
	retrospective: ["검토 일정의 구체화가 필요하다."],
	summary: ["배포 문서를 준비한다."],
	actions: [
		{
			owner: "민수",
			task: "배포 문서 작성",
			due: null,
			evidence: "배포 문서를 작성하겠습니다.",
			segment: 0,
		},
	],
	references: [],
};
test("renders four sections and safely collapsed transcript", () => {
	// Given
	const transcript = [
		{
			start: 0,
			end: 1,
			speaker: "미상",
			text: "</details><script>alert(1)</script>",
		},
	];
	// When
	const md = render({
		id: "demo",
		meeting: input,
		transcript,
		summary,
		sources: [],
	});
	// Then
	expect(md).toContain("## 1. 요약");
	expect(md).toContain("## 4. 전문");
	expect(md).toContain("&lt;script&gt;");
	expect(md).toContain("미정");
});
test("rejects fabricated historical quotation", () => {
	// Given
	const bad = {
		...summary,
		references: [
			{
				sourceId: "missing",
				relation: "supports" as const,
				explanation: "관련",
				quote: "없는 원문",
			},
		],
	};
	// When / Then
	expect(() => validateEvidence(bad, input.transcript, [])).toThrow(
		"invalid_reference_evidence",
	);
});
test("deduplicates same revision and rejects changed payload", () => {
	// Given
	const store = new Store(":memory:");
	// When
	const first = store.enqueue(input);
	const second = store.enqueue(input);
	// Then
	expect(first.id).toBe(second.id);
	expect(store.list()).toHaveLength(1);
	expect(() => store.enqueue({ ...input, title: "다른 회의" })).toThrow(
		"revision_conflict",
	);
	store.db.close();
});
test("HTTP intake completes into Markdown and ontology with persistent SQLite", async () => {
	// Given
	const store = new Store(":memory:");
	const token = "test-token-12345678901234567890";
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: createApp(store, token).fetch,
	});
	try {
		const headers = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};
		// When
		const response = await fetch(new URL("/v1/meetings", server.url), {
			method: "POST",
			headers,
			body: JSON.stringify(input),
		});
		await tick(store, {
			transcribe: async () => input.transcript,
			summarize: async () => summary,
			deliver: null,
		});
		const job = store.list()[0];
		// Then
		expect(response.status).toBe(202);
		expect(job?.status).toBe("ready");
		const md = await fetch(
			new URL(`/v1/meetings/${job?.id}/markdown`, server.url),
			{ headers },
		);
		expect(await md.text()).toContain("배포 문서 작성");
		expect(graph(store, job?.id ?? "")).not.toBeNull();
		const resultUrl = new URL('/v1/meetings/' + job?.id + '/result', server.url);
		const result = await fetch(resultUrl, { headers });
		expect(result.status).toBe(200);
		expect(await result.json()).toMatchObject({ summary, transcript: input.transcript, ontology: { schema_version: 1 } });
		expect((await fetch(resultUrl)).status).toBe(401);

		expect((await fetch(new URL("/v1/meetings", server.url))).status).toBe(401);
	} finally {
		server.stop(true);
		store.db.close();
	}
});
test("does not retranscribe after summary failure and flags ambiguous delivery", async () => {
	// Given
	const store = new Store(":memory:");
	store.enqueue({
		project: input.project,
		title: input.title,
		date: input.date,
		sourceId: input.sourceId,
		revision: input.revision,
		driveFileId: "file1",
	});
	let calls = 0;
	const transcribe = async () => {
		calls++;
		return input.transcript;
	};
	await tick(store, {
		transcribe,
		summarize: async () => {
			throw new Error("temporary");
		},
		deliver: null,
	});
	store.db.query("UPDATE jobs SET next_at=0").run();
	// When
	await tick(store, {
		transcribe,
		summarize: async () => summary,
		deliver: async () => {
			throw new Error("lost response");
		},
	});
	// Then
	expect(calls).toBe(1);
	expect(store.list()[0]?.delivery).toBe("uncertain");
	store.db.close();
});
test("retrieval excludes other projects and future records", () => {
	// Given
	const store = new Store(":memory:");
	for (const [id, project, date] of [
		["old", "demo", "2026-09-01"],
		["foreign", "other", "2026-09-01"],
		["future", "demo", "2027-01-01"],
	]) {
		store.putSource({
			id: id ?? "",
			project: project ?? "",
			date: date ?? "",
			title: "배포",
			text: "배포 문서",
			uri: "https://example.org/doc",
		});
	}
	// When
	const found = store.search(input, "배포 문서");
	// Then
	expect(found.map((s) => s.id)).toEqual(["old"]);
	store.db.close();
});
