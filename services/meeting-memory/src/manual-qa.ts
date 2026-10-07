import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { createApp } from "./app";
import { Meeting, Source, Summary } from "./domain";
import { http } from "./http";
import { tick } from "./pipeline";
import { Store } from "./store";

await mkdir("data", { recursive: true });
const path = `data/qa-${Date.now()}.sqlite`,
	store = new Store(path);
const token = crypto.randomUUID() + crypto.randomUUID();
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: createApp(store, token).fetch,
});
const headers = { Authorization: `Bearer ${token}` };
try {
	const source = Source.parse({
		id: "launch-checklist-v1",
		project: "demo",
		title: "이전 출시 체크리스트",
		date: "2026-09-01",
		uri: "https://example.org/launch-checklist",
		text: "출시 전에 고객사 검토를 완료한다.",
	});
	await http.post(new URL("/v1/sources", server.url), {
		headers,
		json: source,
	});
	const meeting = Meeting.parse({
		project: "demo",
		title: "출시 준비 회의 (가상 예제)",
		date: "2026-09-08",
		sourceId: "demo-recording",
		revision: "1",
		transcript: [
			{
				start: 0,
				end: 8,
				speaker: "민수",
				text: "고객사 검토 문서는 제가 작성하겠습니다.",
			},
			{
				start: 8,
				end: 18,
				speaker: "지연",
				text: "이전 출시 체크리스트대로 고객사 검토를 완료한 뒤 배포일을 확정합시다.",
			},
		],
	});
	const queued = z
		.object({ id: z.string() })
		.parse(
			await http
				.post(new URL("/v1/meetings", server.url), { headers, json: meeting })
				.json(),
		);
	const summary = Summary.parse({
		background: "출시 준비를 논의했다.",
		keyPoints: ["고객사 검토 후 배포일을 결정한다."],
		issues: ["기한은 정하지 않았다."],
		retrospective: ["검토 일정의 구체화가 필요하다."],
		summary: ["고객사 검토를 완료한 뒤 배포일을 확정하기로 했다."],
		actions: [
			{
				owner: "민수",
				task: "고객사 검토 문서 작성",
				due: null,
				evidence: "고객사 검토 문서는 제가 작성하겠습니다.",
				segment: 0,
			},
		],
		references: [
			{
				sourceId: source.id,
				relation: "continues",
				explanation:
					"이전 체크리스트의 사전 고객사 검토 절차를 이번 출시에도 적용한다.",
				quote: source.text,
			},
		],
	});
	await tick(store, {
		transcribe: async () => {
			throw new Error("not used");
		},
		summarize: async () => summary,
		deliver: null,
	});
	const markdown = await http
		.get(new URL(`/v1/meetings/${queued.id}/markdown`, server.url), { headers })
		.text();
	const ontology = await http
		.get(new URL(`/v1/meetings/${queued.id}/ontology`, server.url), { headers })
		.json();
	await Bun.write("examples/meeting.md", markdown);
	await Bun.write("examples/ontology.json", JSON.stringify(ontology, null, 2));
	await http.post(new URL(`/v1/meetings/${queued.id}/review`, server.url), {
		headers,
	});
	console.info(
		JSON.stringify({
			http: "passed",
			markdown: "examples/meeting.md",
			ontology: "examples/ontology.json",
			id: queued.id,
		}),
	);
	store.db.close();
	const reopened = new Store(path);
	if (reopened.get(queued.id)?.reviewed !== 1)
		throw new Error("review was not persisted");
	reopened.db.close();
	console.info("SQLite reopen: reviewed meeting persisted.");
} finally {
	server.stop(true);
}
