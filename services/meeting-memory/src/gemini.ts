import { z } from "zod";
import type { Settings } from "./config";
import { ServiceError } from "./domain";
import { http } from "./http";

export async function generateGemini(
	input: {
		readonly model: string;
		readonly parts: readonly unknown[];
		readonly schema: unknown;
	},
	settings: Settings,
): Promise<unknown> {
	if (!settings.GEMINI_API_KEY) throw new ServiceError("gemini_not_configured");
	const response = z
		.object({
			candidates: z
				.array(
					z.object({
						finishReason: z.string(),
						content: z.object({
							parts: z.array(
								z.object({
									text: z.string().optional(),
									thought: z.boolean().optional(),
								}),
							),
						}),
					}),
				)
				.min(1),
		})
		.parse(
			await http
				.post(
					`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
					{
						headers: { "x-goog-api-key": settings.GEMINI_API_KEY },
						timeout: 600000,
						json: {
							contents: [{ role: "user", parts: input.parts }],
							generationConfig: {
								responseMimeType: "application/json",
								responseJsonSchema: input.schema,
								maxOutputTokens: 32768,
								temperature: 0.1,
							},
						},
					},
				)
				.json(),
		);
	const candidate = response.candidates[0];
	if (!candidate || candidate.finishReason !== "STOP")
		throw new ServiceError(
			"gemini_output_incomplete:" +
				(candidate?.finishReason ?? "missing_candidate"),
		);
	return JSON.parse(
		candidate.content.parts
			.filter((p) => !p.thought)
			.map((p) => p.text ?? "")
			.join(""),
	);
}
const RemoteFile = z.object({
	name: z.string().regex(/^files\/[a-zA-Z0-9_-]+$/),
	uri: z.string().url(),
	mimeType: z.string(),
	state: z.string(),
});
export async function withGeminiAudio<T>(
	audio: { readonly blob: Blob; readonly name: string },
	settings: Settings,
	use: (part: unknown) => Promise<T>,
): Promise<T> {
	if (!settings.GEMINI_API_KEY) throw new ServiceError("gemini_not_configured");
	const mime = audio.blob.type || "audio/mp4";
	const headers = { "x-goog-api-key": settings.GEMINI_API_KEY };
	const start = await http.post(
		"https://generativelanguage.googleapis.com/upload/v1beta/files",
		{
			headers: {
				...headers,
				"X-Goog-Upload-Protocol": "resumable",
				"X-Goog-Upload-Command": "start",
				"X-Goog-Upload-Header-Content-Length": String(audio.blob.size),
				"X-Goog-Upload-Header-Content-Type": mime,
			},
			json: { file: { display_name: "meeting-recording" } },
		},
	);
	const upload = start.headers.get("x-goog-upload-url");
	if (
		!upload ||
		new URL(upload).origin !== "https://generativelanguage.googleapis.com"
	)
		throw new ServiceError("invalid_gemini_upload_url");
	let file = RemoteFile.parse(
		z.object({ file: RemoteFile }).parse(
			await http
				.post(upload, {
					headers: {
						"X-Goog-Upload-Offset": "0",
						"X-Goog-Upload-Command": "upload, finalize",
					},
					body: audio.blob,
					timeout: 600000,
				})
				.json(),
		).file,
	);
	try {
		const deadline = Date.now() + 120000;
		while (file.state === "PROCESSING" && Date.now() < deadline) {
			await Bun.sleep(2000);
			file = RemoteFile.parse(
				await http
					.get(
						`https://generativelanguage.googleapis.com/v1beta/${file.name}`,
						{ headers },
					)
					.json(),
			);
		}
		if (file.state !== "ACTIVE")
			throw new ServiceError("gemini_file_not_ready");
		return await use({
			file_data: { mime_type: file.mimeType, file_uri: file.uri },
		});
	} finally {
		try {
			await http.delete(
				`https://generativelanguage.googleapis.com/v1beta/${file.name}`,
				{ headers },
			);
		} catch (error) {
			if (!(error instanceof Error)) throw error;
			console.warn(
				"gemini_file_cleanup_failed: remote file expires automatically",
			);
		}
	}
}
