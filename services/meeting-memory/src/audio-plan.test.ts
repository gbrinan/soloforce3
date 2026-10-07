import { expect, test } from "bun:test";
import { planAudio, mapPart } from "./audio-plan";
const pcm = (seconds: number, spans: readonly [number, number, number][]) => {
	const bytes = Buffer.alloc(seconds * 16000 * 2);
	for (const [start, end, amplitude] of spans)
		for (let i = start * 16000; i < end * 16000; i++)
			bytes.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2);
	return bytes;
};
test("excludes sustained silence and isolated clicks, preserving quiet speech offsets", () => {
	const audio = pcm(10, [
		[1, 2, 300],
		[5, 6, 1000],
		[9, 9.02, 20000],
	]);
	const parts = planAudio(audio);
	expect(parts).toHaveLength(2);
	expect(parts[0]?.start).toBeCloseTo(0.7);
	expect(parts[1]?.start).toBeCloseTo(4.7);
	expect(parts[1]?.end).toBeLessThan(7);
});
test("bounds long speech and supplies overlapping boundary context", () => {
	const parts = planAudio(pcm(400, [[0, 400, 1000]]));
	expect(parts).toHaveLength(3);
	expect(parts.every((p) => p.end - p.start <= 181)).toBe(true);
	expect(parts[1]?.start).toBeLessThan(parts[0]?.end ?? 0);
	expect(parts.at(-1)?.coreEnd).toBe(400);
});
test("silence produces no provider request plan", () =>
	expect(planAudio(pcm(5, []))).toEqual([]));
test("restores timestamps and rejects invented out-of-chunk times", () => {
	const part = { start: 179.5, end: 360.5, coreStart: 180, coreEnd: 360 };
	const mapped = mapPart(
		[{ start: 1, end: 2, speaker: "화자 1", text: "검토합니다" }],
		part,
		1,
		"gemini",
	);
	expect(mapped[0]?.start).toBe(180.5);
	expect(mapped[0]?.speaker).toBe("구간 2 · 화자 1");
	expect(() =>
		mapPart(
			[{ start: 300, end: 301, speaker: "x", text: "x" }],
			part,
			1,
			"gemini",
		),
	).toThrow("audio_chunk_timestamp_invalid");
});
