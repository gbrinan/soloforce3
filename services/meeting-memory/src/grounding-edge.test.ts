import { expect, test } from "bun:test";
import { Summary, validateEvidence } from "./domain";
import { groundSummary } from "./grounding";
const summary = Summary.parse({
	summary: ["계획 준비"],
	background: "",
	keyPoints: [],
	issues: [],
	retrospective: [],
	references: [],
	actions: [
		{
			task: "계획 준비",
			owner: null,
			due: null,
			evidence: "제가 준비합니다.",
			segment: 99,
		},
	],
});
const repeated = [
	{ start: 0, end: 1, speaker: "민수", text: "제가 준비합니다." },
	{ start: 2, end: 3, speaker: "지연", text: "제가 준비합니다." },
];
test("ambiguous repeated quotation cannot be assigned to an arbitrary speaker", () => {
	// Given / When
	const result = groundSummary(summary, repeated, []);
	// Then
	expect(result.actions).toHaveLength(0);
	expect(result.reviewIssues?.[0]?.code).toBe("action_evidence_unverified");
});
test("valid explicit speaker ownership and exact quotation survive grounding", () => {
	// Given
	const valid = Summary.parse({
		...summary,
		actions: [{ ...summary.actions[0], segment: 0, owner: "민수" }],
	});
	// When
	const result = groundSummary(valid, repeated, []);
	// Then
	expect(result).toEqual(valid);
	expect(() => validateEvidence(result, repeated, [])).not.toThrow();
});
test("whitespace and punctuation edits are not passed off as exact quotations", () => {
	// Given
	const changed = Summary.parse({
		...summary,
		actions: [
			{ ...summary.actions[0], evidence: "제가 준비 합니다", segment: 0 },
		],
	});
	// When
	const result = groundSummary(changed, repeated, []);
	// Then
	expect(result.actions).toHaveLength(0);
	expect(result.reviewIssues?.[0]?.code).toBe("action_evidence_unverified");
});
