import { Hono, type Context } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { corpusAccessAllowed } from "./corpus/routes.js";

export function createMeetingMemoryRoutes(
	directory: string,
	authorize: (c: Context) => boolean = (c) => corpusAccessAllowed(c),
) {
	const app = new Hono();
	app.use("*", async (c, next) => {
		if (!authorize(c)) return c.json({ error: "owner_required" }, 403);
		c.header("Cache-Control", "no-store");
		c.header("X-Content-Type-Options", "nosniff");
		await next();
	});
	app.get("/:token/:format", async (c) => {
		const token = c.req.param("token"),
			format = c.req.param("format");
		if (
			!/^[a-f0-9]{32}$/.test(token) ||
			!["markdown", "ontology"].includes(format)
		)
			return c.json({ error: "not_found" }, 404);
		try {
			const content = await readFile(
				join(
					directory,
					`${token}.${format === "markdown" ? "md" : "ontology.json"}`,
				),
				"utf8",
			);
			c.header(
				"Content-Type",
				format === "markdown"
					? "text/markdown; charset=utf-8"
					: "application/json",
			);
			return c.body(content);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return c.json({ error: "not_ready" }, 404);
			throw error;
		}
	});
	return app;
}
