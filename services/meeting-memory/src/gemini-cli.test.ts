import { expect, test } from "bun:test";
import { cliError, subscriptionEnv } from "./gemini-cli";
import { Store } from "./store";

test("subscription environment never forwards provider keys", () => {
	const env = subscriptionEnv("/test/home");
	expect(env["GEMINI_API_KEY"]).toBeUndefined();
	expect(env["GOOGLE_API_KEY"]).toBeUndefined();
	expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
	expect(env["GEMINI_CLI_HOME"]).toBe("/test/home");
});
test("quota exhaustion parks the job until explicit retry", () => {
	const store = new Store(":memory:");
	store.enqueue({
		project: "p",
		title: "t",
		date: "2026-09-09",
		sourceId: "s",
		revision: "1",
		driveFileId: "s",
	});
	const job = store.claim();
	if (!job) throw new Error("missing test job");
	store.fail(job, cliError("RESOURCE_EXHAUSTED 429").code);
	expect(store.get(job.id)?.status).toBe("waiting");
	expect(store.claim()).toBeNull();
	store.db.close();
});
test("authentication failures are distinct from normal CLI failures", () => {
	expect(cliError("OAuth credentials missing").code).toBe("cli_auth_required");
	expect(cliError("Invalid media").code).toBe("cli_failed");
});

test("CLI settings use the runtime nested .gemini directory", async () => {
	const { mkdtemp, readFile, rm } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");
	const { prepareCli } = await import("./gemini-cli");
	const { Config } = await import("./config");
	const dir = await mkdtemp(join(tmpdir(), "meeting-cli-test-"));
	try {
		const paths = await prepareCli(
			Config.parse({
				SERVICE_TOKEN: "test-token-at-least-24-characters",
				DATA_DIR: dir,
			}),
		);
		const content = await readFile(
			join(paths.home, ".gemini", "settings.json"),
			"utf8",
		);
		expect(content).toContain('"selectedType":"oauth-personal"');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("retired clients require migration rather than another login", () => {
	expect(
		cliError("Error authenticating: IneligibleTierError UNSUPPORTED_CLIENT")
			.code,
	).toBe("cli_migration_required");
});
