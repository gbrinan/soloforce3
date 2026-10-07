import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
	Segment,
	ServiceError,
	Transcript,
	type TranscriptData,
} from "./domain";
import { planAudio, mapPart, SAMPLE_RATE, wave } from "./audio-plan";
export type Audio = { readonly blob: Blob; readonly name: string };
export async function transcribeParts(
	input: {
		readonly pcm: Buffer;
		readonly cacheDirectory: string;
		readonly provider: string;
		readonly model: string;
	},
	transcribe: (audio: Audio) => Promise<TranscriptData>,
): Promise<TranscriptData> {
	const parts = planAudio(input.pcm);
	if (!parts.length) throw new ServiceError("audio_speech_not_detected");
	await mkdir(input.cacheDirectory, { recursive: true });
	const result: TranscriptData = [];
	for (const [index, part] of parts.entries()) {
		const pcm = input.pcm.subarray(
			Math.round(part.start * SAMPLE_RATE) * 2,
			Math.round(part.end * SAMPLE_RATE) * 2,
		);
		const key = createHash("sha256")
			.update("audio-v1:" + input.provider + ":" + input.model)
			.update(pcm)
			.digest("hex");
		const path = join(input.cacheDirectory, key + ".json");
		let segments: TranscriptData;
		try {
			segments = z
				.array(Segment)
				.parse(JSON.parse(await readFile(path, "utf8")));
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				error.code !== "ENOENT"
			)
				throw error;
			segments = z
				.array(Segment)
				.parse(
					await transcribe({
						blob: new Blob([new Uint8Array(wave(pcm))], { type: "audio/wav" }),
						name: "chunk.wav",
					}),
				);
			mapPart(segments, part, index, input.provider);
			await writeFile(path + ".tmp", JSON.stringify(segments), { mode: 0o600 });
			await rename(path + ".tmp", path);
		}
		result.push(...mapPart(segments, part, index, input.provider));
	}
	return Transcript.parse(result);
}
