import { z } from "zod";
// Provider wire schema omits unsupported length/range constraints; Summary validates them locally.
export const WireSummary = z
	.object({
		summary: z.array(z.string()),
		background: z.string(),
		keyPoints: z.array(z.string()),
		issues: z.array(z.string()),
		retrospective: z.array(z.string()),
		actions: z.array(
			z
				.object({
					owner: z.string().nullable(),
					task: z.string(),
					due: z.string().nullable(),
					evidence: z.string(),
					segment: z.number().int(),
				})
				.strict(),
		),
		references: z.array(
			z
				.object({
					sourceId: z.string(),
					relation: z.enum(["continues", "changes", "supports", "contradicts"]),
					explanation: z.string(),
					quote: z.string(),
				})
				.strict(),
		),
	})
	.strict();
