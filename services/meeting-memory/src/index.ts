import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "./app";
import { Config } from "./config";
import { downloadDrive } from "./drive";
import { tick } from "./pipeline";
import { Store } from "./store";
import { summarize } from "./summarize";
import { loadUpload } from "./uploads";
import { transcribeAudio } from "./audio-transcription";

const settings = Config.parse(process.env);
await mkdir(settings.DATA_DIR, { recursive: true });
const store = new Store(join(settings.DATA_DIR, "meetings.sqlite"));

const app = createApp(store, settings.SERVICE_TOKEN);
const server = Bun.serve({
	hostname: settings.HOST,
	port: settings.PORT,
	maxRequestBodySize: 201 * 1024 * 1024,
	fetch: app.fetch,
});
store.recover();

let stopped = false;
const stop = () => {
	stopped = true;
	server.stop();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
console.info(`Meeting Memory listening on ${server.url}`);
while (!stopped) {
	await tick(store, {
		transcribe: async (id, revision, meeting) =>
			transcribeAudio(
				meeting.uploadId
					? loadUpload(store, meeting.uploadId)
					: await downloadDrive(id, revision, settings),
				{
					...settings,
					TRANSCRIBER: meeting.transcriptionProvider ?? settings.TRANSCRIBER,
				},
			),
		summarize: (input) => summarize(input, settings),
		deliver: null,
	});
	await Bun.sleep(1000);
}
store.db.close();
