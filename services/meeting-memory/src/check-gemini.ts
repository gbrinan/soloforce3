import { HTTPError } from "ky";
import { z } from "zod";
import { http } from "./http";

const key = process.env["GEMINI_API_KEY"]?.trim();
const model = process.env["GEMINI_MODEL"] || "gemini-2.5-flash";
if (!key) {
	console.error("GEMINI_API_KEY is missing. Set it in the local .env file.");
	process.exitCode = 1;
} else {
	try {
		const result = z
			.object({
				name: z.string(),
				supportedGenerationMethods: z.array(z.string()).optional(),
			})
			.parse(
				await http
					.get(
						`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
						{ headers: { "x-goog-api-key": key }, retry: 0, timeout: 20000 },
					)
					.json(),
			);
		console.info(
			JSON.stringify({
				authenticated: true,
				model: result.name,
				supportsGeneration:
					result.supportedGenerationMethods?.includes("generateContent") ??
					false,
			}),
		);
	} catch (error) {
		if (error instanceof HTTPError)
			console.error(
				`Gemini authentication/model check failed: HTTP ${error.response.status}.`,
			);
		else if (error instanceof Error)
			console.error(
				"Gemini check failed: network or response validation error.",
			);
		else throw error;
		process.exitCode = 1;
	}
}
