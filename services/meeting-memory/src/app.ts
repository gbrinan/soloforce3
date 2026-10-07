import { swaggerUI } from "@hono/swagger-ui";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { describeRoute, openAPIRouteHandler, validator } from "hono-openapi";
import { Meeting, ServiceError, Source } from "./domain";
import { registerUploads } from "./uploads";
import { graph } from "./ontology";
import { reviewMeeting } from "./review";
import type { Store } from "./store";
export function createApp(store: Store, token: string): Hono {
	const app = new Hono();
	app.get("/health", (c) => c.json({ status: "ok" }));
	app.use("/v1/*", bearerAuth({ token }));
	app.use("/v1/*", async (c, next) =>
		bodyLimit({
			maxSize:
				c.req.path === "/v1/uploads" ? 201 * 1024 * 1024 : 2 * 1024 * 1024,
		})(c, next),
	);
	app.use("/v1/*", async (c, next) => {
		c.header("Cache-Control", "no-store");
		c.header("X-Content-Type-Options", "nosniff");
		await next();
	});
	app.onError((error, c) => {
		if (error instanceof HTTPException) return error.getResponse();
		if (error instanceof ServiceError)
			return c.json({ error: error.code }, 409);
		return c.json({ error: "internal_error" }, 500);
	});
	registerUploads(app, store);
	app.post(
		"/v1/meetings",
		describeRoute({
			summary: "Queue a transcript or Drive recording",
			responses: { 202: { description: "Queued or deduplicated" } },
		}),
		validator("json", Meeting),
		(c) => {
			const input = c.req.valid("json");
			if (input.uploadId) return c.json({ error: "use_multipart_upload" }, 400);
			const job = store.enqueue(input);
			return c.json({ id: job.id, status: job.status }, 202);
		},
	);
	app.get(
		"/v1/meetings",
		describeRoute({ summary: "List latest 100 jobs" }),
		(c) =>
			c.json(
				store.list().map((j) => ({
					id: j.id,
					status: j.status,
					error: j.error,
					delivery: j.delivery,
					reviewed: Boolean(j.reviewed),
				})),
			),
	);
	app.get(
		"/v1/meetings/:id",
		describeRoute({ summary: "Read job status" }),
		(c) => {
			const j = store.get(c.req.param("id"));
			return j
				? c.json({
						id: j.id,
						status: j.status,
						error: j.error,
						delivery: j.delivery,
						reviewed: Boolean(j.reviewed),
					})
				: c.json({ error: "not_found" }, 404);
		},
	);
	app.get("/v1/meetings/:id/result", (c) => {
		const j = store.get(c.req.param("id"));
		if (j?.status !== "ready" || !j.markdown || !j.summary || !j.transcript)
			return c.json({ error: "not_ready" }, 409);
		return c.json({
			markdown: j.markdown,
			summary: JSON.parse(j.summary),
			transcript: JSON.parse(j.transcript),
			ontology: graph(store, j.id),
		});
	});
	app.get(
		"/v1/meetings/:id/markdown",
		describeRoute({ summary: "Read agent-friendly Markdown" }),
		(c) => {
			const j = store.get(c.req.param("id"));
			if (!j) return c.json({ error: "not_found" }, 404);
			if (!j.markdown) return c.json({ error: "not_ready" }, 409);
			c.header("Content-Type", "text/markdown; charset=utf-8");
			return c.body(
				j.reviewed
					? j.markdown.replace(
							"review_status: unreviewed",
							"review_status: reviewed",
						)
					: j.markdown,
			);
		},
	);
	app.get(
		"/v1/meetings/:id/ontology",
		describeRoute({ summary: "Read provenance and proposed relations" }),
		(c) => {
			const data = graph(store, c.req.param("id"));
			return data ? c.json(data) : c.json({ error: "not_ready" }, 404);
		},
	);
	app.post(
		"/v1/sources",
		describeRoute({ summary: "Index a historical source within a project" }),
		validator("json", Source),
		(c) => {
			store.putSource(c.req.valid("json"));
			return c.json({ stored: true }, 201);
		},
	);
	app.post(
		"/v1/meetings/:id/review",
		describeRoute({
			summary: "Human confirms names commitments and references",
		}),
		(c) => {
			const job = store.get(c.req.param("id"));
			if (job?.status !== "ready") return c.json({ error: "not_ready" }, 409);
			reviewMeeting(store, job.id, new URL(c.req.url).origin);
			return c.json({ reviewed: true });
		},
	);
	app.post(
		"/v1/meetings/:id/retry",
		describeRoute({
			summary: "Retry a failed job after correcting configuration",
		}),
		(c) => {
			const job = store.get(c.req.param("id"));
			if (job?.status !== "failed" && job?.status !== "waiting")
				return c.json({ error: "not_failed" }, 409);
			store.db
				.query(
					"UPDATE jobs SET status='queued',attempts=0,next_at=0 WHERE id=?",
				)
				.run(job.id);
			return c.json({ queued: true });
		},
	);
	app.get(
		"/openapi.json",
		openAPIRouteHandler(app, {
			documentation: {
				info: { title: "Meeting Memory", version: "0.1.0" },
				components: {
					securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
				},
				security: [{ bearerAuth: [] }],
			},
		}),
	);
	app.get("/docs", Scalar({ url: "/openapi.json" }));
	app.get("/swagger", swaggerUI({ url: "/openapi.json" }));
	return app;
}
