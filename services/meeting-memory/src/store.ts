import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { MeetingInput, SourceData } from "./domain";
import { Meeting, ServiceError, Source } from "./domain";

const Job = z.object({
	id: z.string(),
	input: z.string(),
	status: z.enum(["queued", "running", "ready", "failed", "waiting"]),
	attempts: z.number(),
	next_at: z.number(),
	transcript: z.string().nullable(),
	summary: z.string().nullable(),
	sources: z.string().nullable(),
	markdown: z.string().nullable(),
	error: z.string().nullable(),
	delivery: z.enum(["pending", "sending", "sent", "uncertain", "disabled"]),
	reviewed: z.number(),
});
export type JobData = z.infer<typeof Job>;
export const digest = (s: string) =>
	createHash("sha256").update(s).digest("hex");
export class Store {
	readonly db: Database;
	constructor(path: string) {
		this.db = new Database(path, { create: true });
		this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,input TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,transcript TEXT,summary TEXT,sources TEXT,markdown TEXT,error TEXT,delivery TEXT NOT NULL DEFAULT 'pending',reviewed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,mime TEXT NOT NULL,bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(id TEXT NOT NULL,project TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project,id));`);
	}
	recover(): void {
		this.db.exec(
			"UPDATE jobs SET status='queued' WHERE status='running'; UPDATE jobs SET delivery='uncertain' WHERE delivery='sending'",
		);
	}
	enqueue(input: MeetingInput): JobData {
		const id = digest(
			[input.project, input.sourceId, input.revision].join("\0"),
		);
		const old = this.get(id);
		if (old && old.input !== JSON.stringify(input))
			throw new ServiceError("revision_conflict");
		this.db
			.query("INSERT OR IGNORE INTO jobs(id,input) VALUES (?,?)")
			.run(id, JSON.stringify(input));
		const job = this.get(id);
		if (!job) throw new ServiceError("job_insert_failed");
		return job;
	}
	get(id: string): JobData | null {
		const row = this.db.query("SELECT * FROM jobs WHERE id=?").get(id);
		return row ? Job.parse(row) : null;
	}
	pendingDelivery(): JobData | null {
		const row = this.db
			.query(
				"SELECT * FROM jobs WHERE status='ready' AND delivery='pending' ORDER BY rowid LIMIT 1",
			)
			.get();
		return row ? Job.parse(row) : null;
	}
	list(): JobData[] {
		return z
			.array(Job)
			.parse(
				this.db.query("SELECT * FROM jobs ORDER BY rowid DESC LIMIT 100").all(),
			);
	}
	claim(): JobData | null {
		const row = this.db
			.query(
				"UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE status='queued' AND next_at<=? ORDER BY rowid LIMIT 1) RETURNING *",
			)
			.get(Date.now());
		return row ? Job.parse(row) : null;
	}
	checkpoint(id: string, transcript: string): void {
		this.db
			.query("UPDATE jobs SET transcript=? WHERE id=?")
			.run(transcript, id);
	}
	complete(
		id: string,
		result: {
			readonly summary: string;
			readonly sources: string;
			readonly markdown: string;
		},
	): void {
		this.db
			.query(
				"UPDATE jobs SET status='ready',summary=?,sources=?,markdown=?,error=NULL WHERE id=?",
			)
			.run(result.summary, result.sources, result.markdown, id);
	}
	fail(job: JobData, code: string): void {
		if (
			code === "cli_quota_wait" ||
			code === "cli_auth_required" ||
			code === "cli_migration_required" ||
			code === "provider_quota_wait" ||
			code.endsWith("_not_configured") ||
			code === "provider_auth_required" ||
			code === "provider_model_unavailable"
		) {
			this.db
				.query("UPDATE jobs SET status='waiting',error=? WHERE id=?")
				.run(code, job.id);
			return;
		}
		this.db
			.query("UPDATE jobs SET status=?,error=?,next_at=? WHERE id=?")
			.run(
				job.attempts >= 3 ? "failed" : "queued",
				code,
				Date.now() + 30000 * 2 ** job.attempts,
				job.id,
			);
	}
	putSource(source: SourceData): void {
		this.db
			.query(
				"INSERT INTO sources VALUES (?,?,?) ON CONFLICT(project,id) DO UPDATE SET payload=excluded.payload",
			)
			.run(source.id, source.project, JSON.stringify(source));
	}
	search(input: MeetingInput, text: string): SourceData[] {
		const rows = z
			.array(z.object({ payload: z.string() }))
			.parse(
				this.db
					.query("SELECT payload FROM sources WHERE project=?")
					.all(input.project),
			);
		const tokens = [
			...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []),
		];
		return rows
			.map((r) => Source.parse(JSON.parse(r.payload)))
			.filter((s) => s.date <= input.date && s.id !== input.sourceId)
			.map((source) => ({
				source,
				score: tokens.reduce(
					(n, t) =>
						n +
						Number(
							(source.title + " " + source.text).toLowerCase().includes(t),
						),
					0,
				),
			}))
			.filter((s) => s.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 8)
			.map((s) => s.source);
	}
	input(job: JobData): MeetingInput {
		return Meeting.parse(JSON.parse(job.input));
	}
	delivery(id: string, state: JobData["delivery"]): void {
		this.db.query("UPDATE jobs SET delivery=? WHERE id=?").run(state, id);
	}
	review(id: string): void {
		this.db.query("UPDATE jobs SET reviewed=1 WHERE id=?").run(id);
	}
}
