import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Config } from "./config";
import { wave } from "./audio-plan";
import { transcribeAudio } from "./audio-transcription";
test("decodes real WAV through FFmpeg and sends bounded speech regions to HTTP provider", async () => {
	const directory = await mkdtemp(join(tmpdir(), "decode-audio-"));
	let calls = 0;
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const form = await request.formData();
			const file = form.get("file");
			expect(file instanceof File).toBe(true);
			if (!(file instanceof File)) throw new Error("expected audio");
			expect(file.size).toBeLessThan(64000);
			calls++;
			return Response.json({
				segments: [{ start: 0.3, end: 0.8, text: "검토" }],
			});
		},
	});
	try {
		const pcm = Buffer.alloc(7 * 32000);
		for (const [start, end, amplitude] of [
			[1, 2, 1000],
			[5, 6, 300],
		]) {
			if (start === undefined || end === undefined || amplitude === undefined)
				throw new Error("fixture");
			for (let i = start * 16000; i < end * 16000; i++)
				pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2);
		}
		const settings = Config.parse({
			SERVICE_TOKEN: "x".repeat(24),
			TRANSCRIBER: "whisper",
			DATA_DIR: directory,
			WHISPER_URL: server.url.href,
		});
		const result = await transcribeAudio(
			{ blob: new Blob([new Uint8Array(wave(pcm))]), name: "test.wav" },
			settings,
		);
		expect(calls).toBe(2);
		expect(result.map((s) => s.start)).toEqual([1, 5]);
	} finally {
		server.stop(true);
		await rm(directory, { recursive: true, force: true });
	}
});
