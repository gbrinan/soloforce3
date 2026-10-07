import { ServiceError, type TranscriptData } from "./domain";
export const SAMPLE_RATE = 16000;
const FRAME = 320;
export type AudioPart = {
	readonly start: number;
	readonly end: number;
	readonly coreStart: number;
	readonly coreEnd: number;
};
export function planAudio(pcm: Buffer): AudioPart[] {
	const duration = pcm.length / 2 / SAMPLE_RATE;
	const ranges: { start: number; end: number }[] = [];
	let first = -1,
		last = -1,
		active = 0;
	const finish = () => {
		if (active >= 10)
			ranges.push({
				start: Math.max(0, first * 0.02 - 0.3),
				end: Math.min(duration, (last + 1) * 0.02 + 0.3),
			});
		first = -1;
		last = -1;
		active = 0;
	};
	for (
		let offset = 0, frame = 0;
		offset < pcm.length;
		offset += FRAME * 2, frame++
	) {
		let squares = 0,
			count = 0;
		for (
			let i = offset;
			i < Math.min(offset + FRAME * 2, pcm.length - 1);
			i += 2
		) {
			const v = pcm.readInt16LE(i) / 32768;
			squares += v * v;
			count++;
		}
		if (count && Math.sqrt(squares / count) >= 10 ** (-50 / 20)) {
			if (first < 0) first = frame;
			last = frame;
			active++;
		} else if (last >= 0 && frame - last >= 150) finish();
	}
	finish();
	const merged: { start: number; end: number }[] = [];
	for (const range of ranges) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end) previous.end = range.end;
		else merged.push({ ...range });
	}
	const parts: AudioPart[] = [];
	for (const range of merged)
		for (let start = range.start; start < range.end; start += 180) {
			const end = Math.min(start + 180, range.end);
			parts.push({
				start: Math.max(range.start, start - 0.5),
				end: Math.min(range.end, end + 0.5),
				coreStart: start,
				coreEnd: end,
			});
		}
	return parts;
}
export function mapPart(
	transcript: TranscriptData,
	part: AudioPart,
	index: number,
	provider: string,
): TranscriptData {
	const duration = part.end - part.start;
	return transcript.flatMap((segment) => {
		if (segment.start > duration + 0.5 || segment.end > duration + 0.5)
			throw new ServiceError("audio_chunk_timestamp_invalid");
		const start = segment.start + part.start,
			end = Math.min(segment.end, duration) + part.start;
		const midpoint = (start + end) / 2;
		if (midpoint < part.coreStart || midpoint >= part.coreEnd) return [];
		return [
			{
				...segment,
				start,
				end,
				speaker:
					provider === "gemini"
						? `구간 ${index + 1} · ${segment.speaker}`
						: segment.speaker,
			},
		];
	});
}
export function wave(pcm: Buffer): Buffer {
	const header = Buffer.alloc(44);
	header.write("RIFF");
	header.writeUInt32LE(pcm.length + 36, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(SAMPLE_RATE, 24);
	header.writeUInt32LE(SAMPLE_RATE * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}
