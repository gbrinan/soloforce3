import { z } from "zod";
import type { Settings } from "./config";
import { ServiceError } from "./domain";
import { http } from "./http";
export async function downloadDrive(
	fileId: string,
	revision: string,
	settings: Settings,
): Promise<{ readonly blob: Blob; readonly name: string }> {
	if (
		!settings.GOOGLE_CLIENT_ID ||
		!settings.GOOGLE_CLIENT_SECRET ||
		!settings.GOOGLE_REFRESH_TOKEN ||
		!settings.DRIVE_FOLDER_ID
	)
		throw new ServiceError("drive_not_configured");
	const token = z.object({ access_token: z.string() }).parse(
		await http
			.post("https://oauth2.googleapis.com/token", {
				body: new URLSearchParams({
					client_id: settings.GOOGLE_CLIENT_ID,
					client_secret: settings.GOOGLE_CLIENT_SECRET,
					refresh_token: settings.GOOGLE_REFRESH_TOKEN,
					grant_type: "refresh_token",
				}),
			})
			.json(),
	);
	const headers = { Authorization: `Bearer ${token.access_token}` };
	const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
	const meta = z
		.object({
			name: z.string(),
			version: z.string(),
			modifiedTime: z.string(),
			mimeType: z.string(),
			size: z.string(),
			parents: z.array(z.string()).default([]),
			trashed: z.boolean().default(false),
		})
		.parse(
			await http
				.get(base, {
					headers,
					searchParams: {
						fields: "name,mimeType,size,parents,trashed,version,modifiedTime",
						supportsAllDrives: "true",
					},
				})
				.json(),
		);
	if (revision !== meta.version && revision !== meta.modifiedTime)
		throw new ServiceError("drive_revision_changed");
	if (meta.trashed || !meta.parents.includes(settings.DRIVE_FOLDER_ID))
		throw new ServiceError("drive_folder_mismatch");
	if (
		!meta.mimeType.startsWith("audio/") &&
		!["video/mp4", "application/ogg"].includes(meta.mimeType)
	)
		throw new ServiceError("unsupported_audio");
	if (Number(meta.size) > 200 * 1024 * 1024)
		throw new ServiceError("audio_exceeds_200mb");
	const blob = await http
		.get(base, {
			headers,
			searchParams: { alt: "media", supportsAllDrives: "true" },
		})
		.blob();
	const after = z.object({ version: z.string() }).parse(
		await http
			.get(base, {
				headers,
				searchParams: { fields: "version", supportsAllDrives: "true" },
			})
			.json(),
	);
	if (after.version !== meta.version || blob.size !== Number(meta.size))
		throw new ServiceError("drive_changed_during_download");
	return { blob: new Blob([blob], { type: meta.mimeType }), name: meta.name };
}
