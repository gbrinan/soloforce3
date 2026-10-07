import { z } from "zod";
import { Source, Summary } from "./domain";
import type { Store } from "./store";
export function graph(store: Store, id: string): unknown {
	const job = store.get(id);
	if (!job?.summary) return null;
	const meeting = store.input(job),
		summary = Summary.parse(JSON.parse(job.summary));
	const sources = z.array(Source).parse(JSON.parse(job.sources ?? "[]"));
	const people = [
		...new Set(summary.actions.flatMap((a) => (a.owner ? [a.owner] : []))),
	];
	const personId = (name: string) =>
		`${meeting.project}:person:${encodeURIComponent(name)}`;
	return {
		"@context": { prov: "http://www.w3.org/ns/prov#" },
		schema_version: 1,
		reviewIssues: summary.reviewIssues ?? [],
		meeting: {
			id,
			project: meeting.project,
			title: meeting.title,
			reviewed: Boolean(job.reviewed),
		},
		entities: [
			{ id, type: "Meeting" },
			{ id: meeting.sourceId, type: "Recording" },
			{ id: meeting.project, type: "Project" },
			...people.map((name) => ({
				id: personId(name),
				type: "Person",
				name,
				identityStatus: "name_only",
			})),
			...summary.actions.map((a, i) => ({
				id: `${id}:action:${i}`,
				type: "Action",
				...a,
			})),
			...sources.map((s) => ({ id: s.id, type: "Document", uri: s.uri })),
		],
		relations: [
			{ from: id, to: meeting.sourceId, type: "prov:wasDerivedFrom" },
			{ from: id, to: meeting.project, type: "belongsTo" },
			...summary.actions.flatMap((a, i) => [
				{ from: `${id}:action:${i}`, to: id, type: "discussedIn" },
				...(a.owner
					? [
							{
								from: `${id}:action:${i}`,
								to: personId(a.owner),
								type: "assignedTo",
							},
						]
					: []),
			]),
			...summary.references.map((r) => ({
				from: id,
				to: r.sourceId,
				type: r.relation,
				evidence: r.quote,
				reviewed: Boolean(job.reviewed),
			})),
		],
	};
}
