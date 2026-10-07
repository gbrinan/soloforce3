import { Config } from "./config";
import { ServiceError } from "./domain";
import { runCli } from "./gemini-cli";

try {
	const result = await runCli(
		"Reply with exactly READY. Do not use tools.",
		Config.parse(process.env),
	);
	console.info(
		JSON.stringify({
			subscriptionCliReachable: result.trim() === "READY",
			apiFallback: false,
		}),
	);
} catch (error) {
	if (error instanceof ServiceError) {
		console.error(error.code);
		process.exitCode = 1;
	} else throw error;
}
