import { z } from "zod";
import { expect, test } from "bun:test";
import { createApp } from "./app";
import {
	Summary,
	ReviewIssue,
	type SummaryData,
	validateEvidence,
} from "./domain";
import { graph } from "./ontology";
import { tick } from "./pipeline";
import { Store } from "./store";

const Result = z.object({
	summary: Summary,
	markdown: z.string(),
	ontology: z.object({
		entities: z.array(z.object({ type: z.string() })),
		reviewIssues: z.array(ReviewIssue),
	}),
});
const transcript = [
	{
		start: 0,
		end: 4,
		speaker: "화자 미상",
		text: "배포 계획은 제가 준비하겠습니다.",
	},
	{
		start: 4,
		end: 9,
		speaker: "화자 미상",
		text: "검토 일정은 아직 정하지 않았습니다.",
	},
];
const meeting = {
	project: "demo",
	title: "검토 회의",
	date: "2026-09-09",
	sourceId: "recording",
	revision: "1",
	transcript,
};
const candidate = Summary.parse({
	summary: ["배포 계획을 준비한다."],
	background: "",
	keyPoints: [],
	issues: [],
	retrospective: [],
	references: [],
	actions: [
		{
			owner: "회사 관계자",
			task: "배포 계획 준비",
			due: null,
			evidence: transcript[0]?.text,
			segment: 0,
		},
	],
});
async function processCandidate(summary: SummaryData) {
	const store = new Store(":memory:");
	const job = store.enqueue(meeting);
	await tick(store, {
		transcribe: async () => {
			throw new Error("must reuse transcript");
		},
		summarize: async () => summary,
		deliver: null,
	});
	return { store, id: job.id };
}

test("unknown model assignee becomes unassigned with a visible review issue, not a failed meeting", async () => {
	// Given / When
	const { store, id } = await processCandidate(candidate);
	try {
		// Then
		expect(store.get(id)?.status).toBe("ready");
		const result = await createApp(store, "fixture-token").request(
			"/v1/meetings/" + id + "/result",
			{ headers: { Authorization: "Bearer fixture-token" } },
		);
		const data = Result.parse(await result.json());
		expect(data.summary.actions[0]?.owner).toBeNull();
		expect(data.summary.reviewIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "owner_unverified" }),
			]),
		);
		expect(data.markdown).toContain("미정");
		expect(data.markdown).toContain("담당자 확인 필요");
		expect(
			data.ontology.entities.filter(
				(e: { type: string }) => e.type === "Person",
			),
		).toHaveLength(0);
		expect(data.ontology.reviewIssues).toHaveLength(1);
		expect(() => validateEvidence(candidate, transcript, [])).toThrow(
			"unknown_owner",
		);
	} finally {
		store.db.close();
	}
});

test("unverifiable action remains visible for review without creating an ontology action", async () => {
	// Given
	const proposed = {
		...candidate,
		actions: [
			{
				...candidate.actions[0],
				owner: null,
				task: "확인되지 않은 결제 진행",
				due: null,
				evidence: "내일 결제합니다.",
				segment: 0,
			},
		],
	};
	// When
	const { store, id } = await processCandidate(Summary.parse(proposed));
	try {
		// Then
		expect(store.get(id)?.status).toBe("ready");
		const result = await createApp(store, "fixture-token").request(
			"/v1/meetings/" + id + "/result",
			{ headers: { Authorization: "Bearer fixture-token" } },
		);
		const data = Result.parse(await result.json());
		expect(data.summary.actions).toHaveLength(0);
		expect(data.summary.reviewIssues?.[0]?.code).toBe(
			"action_evidence_unverified",
		);
		expect(data.markdown).toContain("확인되지 않은 결제 진행");
		expect(data.markdown).toContain("원문 근거 확인 필요");
		expect(
			data.ontology.entities.filter(
				(e: { type: string }) => e.type === "Action",
			),
		).toHaveLength(0);
		expect(() =>
			validateEvidence(Summary.parse(proposed), transcript, []),
		).toThrow("invalid_action_evidence");
	} finally {
		store.db.close();
	}
});

test("a wrong segment index is corrected only by a unique exact quote match", async () => {
	// Given / When
	const { store, id } = await processCandidate(
		Summary.parse({
			...candidate,
			actions: [{ ...candidate.actions[0], owner: null, segment: 1 }],
		}),
	);
	try {
		// Then
		expect(store.get(id)?.status).toBe("ready");
		const saved = Summary.parse(JSON.parse(store.get(id)?.summary ?? "null"));
		expect(saved.actions[0]?.segment).toBe(0);
		expect(saved.actions[0]?.evidence).toBe(transcript[0]?.text);
		expect(() => validateEvidence(saved, transcript, [])).not.toThrow();
	} finally {
		store.db.close();
	}
});

test("invented historical references are flagged without publishing a relation", async () => {
	// Given / When
	const { store, id } = await processCandidate(
		Summary.parse({
			...candidate,
			actions: [],
			references: [
				{
					sourceId: "missing",
					relation: "supports",
					explanation: "과거 계획 확인",
					quote: "없는 인용",
				},
			],
		}),
	);
	try {
		// Then
		expect(store.get(id)?.status).toBe("ready");
		const saved = Summary.parse(JSON.parse(store.get(id)?.summary ?? "null"));
		expect(saved.references).toHaveLength(0);
		expect(store.get(id)?.markdown).toContain("과거 자료 근거 확인 필요");
		expect(JSON.stringify(graph(store, id))).not.toContain('"to":"missing"');
	} finally {
		store.db.close();
	}
});
