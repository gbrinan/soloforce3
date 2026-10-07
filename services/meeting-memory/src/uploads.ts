import { createHash } from "node:crypto";
import { z } from "zod";
import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { Meeting, ServiceError } from "./domain";
import type { Store } from "./store";

export function registerUploads(app: Hono, store: Store): void {
	app.post(
		"/v1/uploads",
		describeRoute({
			summary:
				"Upload audio (multipart file and metadata JSON); transcriptionProvider: groq or gemini",
		}),
		async (c) => {
			const body = await c.req.parseBody();
			const file = body["file"],
				metadata = body["metadata"];
			if (!(file instanceof File) || typeof metadata !== "string")
				return c.json({ error: "file_and_metadata_required" }, 400);
			if (!file.size || file.size > 200 * 1024 * 1024)
				return c.json({ error: "audio_size_limit" }, 413);
			const extension = file.name.split(".").at(-1)?.toLowerCase();
			const mimeTypes: Record<string, string> = {
				m4a: "audio/mp4",
				mp3: "audio/mpeg",
				mp4: "video/mp4",
				wav: "audio/wav",
				flac: "audio/flac",
				ogg: "audio/ogg",
				webm: "audio/webm",
				aac: "audio/aac",
			};
			const mime = extension ? mimeTypes[extension] : undefined;
			if (!mime) return c.json({ error: "unsupported_audio" }, 415);
			let raw: unknown;
			try {
				raw = JSON.parse(metadata);
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
				return c.json({ error: "invalid_metadata_json" }, 400);
			}
			const fields = z.record(z.string(), z.unknown()).safeParse(raw);
			if (
				!fields.success ||
				["uploadId", "driveFileId", "transcript"].some((k) => k in fields.data)
			)
				return c.json({ error: "invalid_upload_metadata" }, 400);
			const bytes = new Uint8Array(await file.arrayBuffer());
			const id = createHash("sha256").update(bytes).digest("hex");
			const parsed = Meeting.safeParse({ ...fields.data, uploadId: id });
			if (!parsed.success) return c.json({ error: "invalid_metadata" }, 400);
			const job = store.db.transaction(() => {
				store.db
					.query("INSERT OR IGNORE INTO uploads(id,mime,bytes) VALUES (?,?,?)")
					.run(id, mime, bytes);
				return store.enqueue(parsed.data);
			})();
			return c.json({ id: job.id, status: job.status }, 202);
		},
	);
}
export function loadUpload(
	store: Store,
	id: string,
): { blob: Blob; name: string } {
	const row = z
		.object({ mime: z.string(), bytes: z.instanceof(Uint8Array) })
		.nullable()
		.parse(store.db.query("SELECT mime,bytes FROM uploads WHERE id=?").get(id));
	if (!row) throw new ServiceError("upload_not_found");
	return {
		blob: new Blob([new Uint8Array(row.bytes)], { type: row.mime }),
		name: `recording.${({ "audio/mp4": "m4a", "audio/mpeg": "mp3", "video/mp4": "mp4", "audio/wav": "wav", "audio/flac": "flac", "audio/ogg": "ogg", "audio/webm": "webm", "audio/aac": "aac" })[row.mime] ?? "m4a"}`,
	};
}
