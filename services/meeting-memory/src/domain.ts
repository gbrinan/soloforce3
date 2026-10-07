import { z } from "zod";

export const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
export const Source = z
	.object({
		id: Id,
		project: Id,
		title: z.string().min(1).max(300),
		date: z.string().date(),
		uri: z
			.string()
			.url()
			.refine((v) => ["https:", "http:"].includes(new URL(v).protocol)),
		text: z.string().min(1).max(100000),
	})
	.strict();
export const Segment = z
	.object({
		start: z.number().min(0),
		end: z.number().min(0),
		speaker: z.string().min(1),
		text: z.string().min(1),
	})
	.strict()
	.refine((s) => s.end >= s.start, "end must follow start");
export const Transcript = z.array(Segment).min(1).max(20000);
export const Meeting = z
	.object({
		project: Id,
		title: z.string().min(1).max(300),
		date: z.string().date(),
		sourceId: Id,
		revision: z.string().min(1).max(120),
		transcript: Transcript.optional(),
		driveFileId: Id.optional(),
		uploadId: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		transcriptionProvider: z.enum(["groq", "gemini"]).optional(),
	})
	.strict()
	.refine(
		(v) =>
			Number(Boolean(v.transcript)) +
				Number(Boolean(v.driveFileId)) +
				Number(Boolean(v.uploadId)) ===
			1,
		"Exactly one transcript, driveFileId or uploadId required",
	);
export const ReviewIssue = z
	.object({
		code: z.enum([
			"owner_unverified",
			"action_evidence_unverified",
			"action_segment_corrected",
			"reference_evidence_unverified",
		]),
		candidateIndex: z.number().int().min(0),
		message: z.string().min(1),
	})
	.strict();
export type ReviewIssueData = z.infer<typeof ReviewIssue>;
export const Summary = z
	.object({
		summary: z.array(z.string().min(1)).min(1).max(20),
		reviewIssues: z.array(ReviewIssue).optional(),
		background: z.string().max(5000),
		keyPoints: z.array(z.string()).max(30),
		issues: z.array(z.string()).max(20),
		retrospective: z.array(z.string()).max(20),
		actions: z
			.array(
				z
					.object({
						owner: z.string().nullable(),
						task: z.string().min(1),
						due: z.string().nullable(),
						evidence: z.string().min(1),
						segment: z.number().int().min(0),
					})
					.strict(),
			)
			.max(100),
		references: z
			.array(
				z
					.object({
						sourceId: Id,
						relation: z.enum([
							"continues",
							"changes",
							"supports",
							"contradicts",
						]),
						explanation: z.string().min(1),
						quote: z.string().min(1),
					})
					.strict(),
			)
			.max(30),
	})
	.strict();
export type MeetingInput = z.infer<typeof Meeting>;
export type TranscriptData = z.infer<typeof Transcript>;
export type SummaryData = z.infer<typeof Summary>;
export type SourceData = z.infer<typeof Source>;
export class ServiceError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}
export function validateEvidence(
	summary: SummaryData,
	transcript: TranscriptData,
	sources: readonly SourceData[],
): void {
	for (const action of summary.actions) {
		const segment = transcript[action.segment];
		if (!segment?.text.includes(action.evidence))
			throw new ServiceError("invalid_action_evidence");
		if (
			action.owner &&
			!transcript.some(
				(s) =>
					s.text.includes(action.owner ?? "") || s.speaker === action.owner,
			)
		) {
			throw new ServiceError("unknown_owner");
		}
	}
	for (const reference of summary.references) {
		if (
			!sources
				.find((s) => s.id === reference.sourceId)
				?.text.includes(reference.quote)
		) {
			throw new ServiceError("invalid_reference_evidence");
		}
	}
}
const escapeMarkdown = (v: string) =>
	v
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replaceAll("[", "&#91;")
		.replaceAll("]", "&#93;")
		.replace(/`/g, "&#96;")
		.replace(/\|/g, "&#124;")
		.replace(/\r?\n/g, " ");
export function render(input: {
	readonly id: string;
	readonly meeting: MeetingInput;
	readonly transcript: TranscriptData;
	readonly summary: SummaryData;
	readonly sources: readonly SourceData[];
}): string {
	const { id, meeting, transcript, summary, sources } = input;
	return [
		"---",
		"schema_version: 1",
		`meeting_id: ${JSON.stringify(id)}`,
		`project: ${JSON.stringify(meeting.project)}`,
		`date: ${meeting.date}`,
		`source_id: ${JSON.stringify(meeting.sourceId)}`,
		"review_status: unreviewed",
		"---",
		`# ${escapeMarkdown(meeting.title)}`,
		"",
		"## 1. 요약",
		"### 배경",
		escapeMarkdown(summary.background),
		"### 결정사항",
		...summary.summary.map((s) => `- ${escapeMarkdown(s)}`),
		"",
		"### 주요내용",
		...summary.keyPoints.map((s) => `- ${escapeMarkdown(s)}`),
		"### 쟁점",
		...summary.issues.map((s) => `- ${escapeMarkdown(s)}`),
		"### 컨텍스트 및 회고 (해석·검토 필요)",
		...summary.retrospective.map((s) => `- ${escapeMarkdown(s)}`),
		"",
		"## 2. 각 대상자가 해야 할 일",
		"| 담당자 | 할 일 | 기한 | 원문 근거 |",
		"|---|---|---|---|",
		...summary.actions.map(
			(a) =>
				`| ${escapeMarkdown(a.owner ?? "미정")} | ${escapeMarkdown(a.task)} | ${escapeMarkdown(a.due ?? "미정")} | [${transcript[a.segment]?.start}s] ${escapeMarkdown(a.evidence)} |`,
		),
		...(summary.actions.length ? [] : ["원문 근거가 확인된 할 일 없음."]),
		"",
		...((summary.reviewIssues?.length ?? 0)
			? [
					"### 확인 필요한 항목",
					...(summary.reviewIssues?.map(
						(issue) => "- " + escapeMarkdown(issue.message),
					) ?? []),
					"",
				]
			: []),
		"## 3. 과거 데이터와 연결되는 참조",
		...summary.references.map((r) => {
			const s = sources.find((s) => s.id === r.sourceId);
			return `- [${escapeMarkdown(s?.title ?? r.sourceId)}](${s?.uri.replaceAll("(", "%28").replaceAll(")", "%29")}) · ID: ${r.sourceId} · ${r.relation}\n  - ${escapeMarkdown(r.explanation)}\n  - 근거: “${escapeMarkdown(r.quote)}”`;
		}),
		...(summary.references.length ? [] : ["확인된 과거 참조 없음."]),
		"",
		"## 4. 전문",
		"<details>",
		"<summary>전문 펼치기</summary>",
		"",
		...transcript.map(
			(s, i) =>
				`- [${s.start}–${s.end}s] **${escapeMarkdown(s.speaker)}** (segment:${i}): ${escapeMarkdown(s.text)}`,
		),
		"",
		"</details>",
		"",
	].join("\n");
}
