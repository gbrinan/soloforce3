import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
	processWithMeetingMemory,
	saveMeetingMemoryArtifacts,
} from "../src/server/meeting-memory.js";
import { createMeetingMemoryRoutes } from "../src/server/meeting-memory-routes.js";
const root = await mkdtemp(join(tmpdir(), "meeting-memory-integration-"));
const token = "a".repeat(32),
	id = "b".repeat(64);
const artifact = {
	markdown:
		"# Test\n## 1. 요약\n## 2. 각 대상자가 해야 할 일\n## 3. 과거 데이터와 연결되는 참조\n## 4. 전문\n<details>test</details>",
	ontology: { schema_version: 1 },
	summary: {
		summary: ["결정"],
		background: "배경",
		keyPoints: [],
		actions: [],
	},
	transcript: [{ start: 0, end: 1, speaker: "미상", text: "결정" }],
};
let stateFailures = 0;
let droppedConnections = 0;
let received = false,
	waiting = false;
const sidecar = new Hono();
sidecar.use("*", async (c, next) => {
	assert.equal(c.req.header("Authorization"), "Bearer fixture-secret");
	await next();
});
sidecar.post("/v1/uploads", async (c) => {
	const form = await c.req.formData();
	assert.ok(form.get("file") instanceof File);
	assert.equal(
		JSON.parse(String(form.get("metadata"))).transcriptionProvider,
		"gemini",
	);
	received = true;
	return c.json({
		id,
		status: waiting ? "waiting" : "ready",
		error: waiting ? "provider_quota_wait" : null,
	});
});
sidecar.get("/v1/meetings/:id", (c) => {
	if (stateFailures > 0) {
		stateFailures--;
		return c.json({ error: "temporarily unavailable" }, 503);
	}
	return c.json({ id, status: "ready" });
});
sidecar.get("/v1/meetings/:id/result", (c) => c.json(artifact));
const server = serve({ fetch: sidecar.fetch, hostname: "127.0.0.1", port: 0 });
server.prependListener("request", (request) => {
	if (droppedConnections > 0) {
		droppedConnections--;
		request.socket.destroy();
	}
});
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const priorUrl = process.env.MEETING_MEMORY_URL,
	priorToken = process.env.MEETING_MEMORY_TOKEN;
process.env.MEETING_MEMORY_URL = "http://127.0.0.1:" + address.port;
process.env.MEETING_MEMORY_TOKEN = "fixture-secret";
try {
	const file = join(root, "recording.m4a");
	await writeFile(file, "fixture");
	let queued = "";
	const input = {
		token,
		title: "회의",
		recordingPath: file,
		date: "2026-09-09",
		provider: "gemini" as const,
		onQueued: (value: string) => {
			queued = value;
		},
	};
	const result = await processWithMeetingMemory(input);
	assert.ok(received);
	assert.equal(queued, id);
	await saveMeetingMemoryArtifacts(root, token, result);
	assert.equal(
		await readFile(join(root, token + ".md"), "utf8"),
		artifact.markdown,
	);
	const reads = createMeetingMemoryRoutes(root, () => true);
	assert.equal((await reads.request("/" + token + "/markdown")).status, 200);
	assert.equal((await reads.request("/" + token + "/ontology")).status, 200);
	assert.equal((await reads.request("/bad/markdown")).status, 404);
	assert.equal(
		(
			await createMeetingMemoryRoutes(root, () => false).request(
				"/" + token + "/markdown",
			)
		).status,
		403,
	);
	received = false;
	stateFailures = 2;
	const resumed = await processWithMeetingMemory({
		...input,
		jobId: id,
		recordingPath: join(root, "missing-recording.m4a"),
	});
	assert.equal(resumed.markdown, artifact.markdown);
	assert.equal(stateFailures, 0);
	assert.equal(received, false, "resuming must not re-upload audio");
	droppedConnections = 1;
	const reconnected = await processWithMeetingMemory({
		...input,
		jobId: id,
		recordingPath: join(root, "missing.m4a"),
	});
	assert.equal(reconnected.markdown, artifact.markdown);
	assert.equal(droppedConnections, 0);
	assert.equal(received, false);
	waiting = true;
	await assert.rejects(
		() => processWithMeetingMemory(input),
		/meeting_memory_waiting:provider_quota_wait/,
	);
	console.log(
		"PASS: actual HTTP sidecar upload, provider choice, preserved job, artifact save, authorized reads, quota without fallback",
	);
} finally {
	server.close();
	if (priorUrl === undefined) delete process.env.MEETING_MEMORY_URL;
	else process.env.MEETING_MEMORY_URL = priorUrl;
	if (priorToken === undefined) delete process.env.MEETING_MEMORY_TOKEN;
	else process.env.MEETING_MEMORY_TOKEN = priorToken;
	await rm(root, { recursive: true, force: true });
}
