import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcribeParts } from "./audio-parts";
test("reuses completed chunk after later chunk fails, preserving absolute time", async () => {
	const directory = await mkdtemp(join(tmpdir(), "audio-parts-"));
	try {
		const pcm = Buffer.alloc(200 * 32000);
		for (let i = 0; i < pcm.length; i += 2)
			pcm.writeInt16LE(i % 4 ? 1000 : -1000, i);
		let calls = 0;
		const input = {
			pcm,
			cacheDirectory: directory,
			provider: "groq",
			model: "test-model",
		};
		await expect(
			transcribeParts(input, async () => {
				calls++;
				if (calls === 2) throw new Error("provider outage");
				return [{ start: 1, end: 2, speaker: "화자 미상", text: "앞 구간" }];
			}),
		).rejects.toThrow("provider outage");
		const result = await transcribeParts(input, async () => {
			calls++;
			return [{ start: 1, end: 2, speaker: "화자 미상", text: "뒤 구간" }];
		});
		expect(calls).toBe(3);
		expect(result).toHaveLength(2);
		expect(result[1]?.start).toBe(180.5);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
