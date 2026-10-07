import type {
	ReviewIssueData,
	SourceData,
	SummaryData,
	TranscriptData,
} from "./domain";

/** Preserve uncertain proposals for review without asserting unsupported provenance. */
export function groundSummary(
	summary: SummaryData,
	transcript: TranscriptData,
	sources: readonly SourceData[],
): SummaryData {
	const reviewIssues: ReviewIssueData[] = [...(summary.reviewIssues ?? [])];
	const actions: SummaryData["actions"] = [];
	for (const [index, action] of summary.actions.entries()) {
		let segment = action.segment;
		if (!transcript[segment]?.text.includes(action.evidence)) {
			const matches = transcript.flatMap((entry, position) =>
				entry.text.includes(action.evidence) ? [position] : [],
			);
			const match = matches.length === 1 ? matches[0] : undefined;
			if (match === undefined) {
				reviewIssues.push({
					code: "action_evidence_unverified",
					candidateIndex: index,
					message: `${action.task}: 원문 근거 확인 필요. 검증된 할 일에서 제외한 AI 제안입니다.`,
				});
				continue;
			}
			segment = match;
			reviewIssues.push({
				code: "action_segment_corrected",
				candidateIndex: index,
				message: `${action.task}: 원문과 정확히 일치하는 인용으로 구간 번호를 보정했습니다.`,
			});
		}
		const proposedOwner = action.owner?.trim() || null;
		const owner =
			proposedOwner &&
			transcript.some(
				(entry) =>
					entry.speaker === proposedOwner || entry.text.includes(proposedOwner),
			)
				? proposedOwner
				: null;
		if (proposedOwner && !owner) {
			reviewIssues.push({
				code: "owner_unverified",
				candidateIndex: index,
				message: `${action.task}: 담당자 확인 필요. 원문에서 확인되지 않아 미정으로 남겼습니다.`,
			});
		}
		actions.push({ ...action, owner, segment });
	}
	const references = summary.references.filter((reference, index) => {
		if (
			sources
				.find((source) => source.id === reference.sourceId)
				?.text.includes(reference.quote)
		)
			return true;
		reviewIssues.push({
			code: "reference_evidence_unverified",
			candidateIndex: index,
			message: `${reference.explanation}: 과거 자료 근거 확인 필요. 검증된 참조 관계에서 제외했습니다.`,
		});
		return false;
	});
	return {
		...summary,
		actions,
		references,
		...(reviewIssues.length ? { reviewIssues } : {}),
	};
}
