import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Settings } from "./config";
import { ServiceError, type TranscriptData } from "./domain";
import { transcribeParts, type Audio } from "./audio-parts";
import { transcribe } from "./transcribe";
export async function transcribeAudio(
	audio: Audio,
	settings: Settings,
): Promise<TranscriptData> {
	if (!Bun.which(settings.FFMPEG_PATH))
		throw new ServiceError("ffmpeg_not_configured");
	await mkdir(settings.DATA_DIR, { recursive: true });
	const directory = await mkdtemp(join(settings.DATA_DIR, "audio-"));
	try {
		const input = join(directory, "input"),
			output = join(directory, "audio.pcm");
		await Bun.write(input, audio.blob);
		const proc = Bun.spawn(
			[
				settings.FFMPEG_PATH,
				"-nostdin",
				"-hide_banner",
				"-loglevel",
				"error",
				"-i",
				input,
				"-vn",
				"-ac",
				"1",
				"-ar",
				"16000",
				"-f",
				"s16le",
				"-t",
				"14401",
				output,
			],
			{ stdout: "ignore", stderr: "pipe" },
		);
		const timer = setTimeout(() => proc.kill(), 120000);
		let code: number;
		try {
			const results = await Promise.all([
				proc.exited,
				new Response(proc.stderr).text(),
			]);
			code = results[0];
		} finally {
			clearTimeout(timer);
		}
		if (code !== 0) throw new ServiceError("audio_decode_failed");
		if ((await stat(output)).size > 14400 * 32000)
			throw new ServiceError("audio_duration_limit_4h");
		return await transcribeParts(
			{
				pcm: await readFile(output),
				cacheDirectory: join(settings.DATA_DIR, "chunks"),
				provider: settings.TRANSCRIBER,
				model: {
					groq: settings.GROQ_MODEL,
					gemini: settings.GEMINI_MODEL,
					whisper: settings.WHISPER_MODEL,
					"gemini-cli": settings.GEMINI_CLI_MODEL,
				}[settings.TRANSCRIBER],
			},
			(chunk) => transcribe(chunk, settings),
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
