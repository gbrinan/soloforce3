import { HTTPError } from "ky";
import { Config } from "./config";
import { http } from "./http";
const settings = Config.parse(process.env);
if (!settings.GROQ_API_KEY) {
	console.error("groq_not_configured");
	process.exitCode = 1;
} else {
	try {
		await http.get("https://api.groq.com/openai/v1/models", {
			headers: { Authorization: `Bearer ${settings.GROQ_API_KEY}` },
			timeout: 20000,
			retry: 0,
		});
		console.info(
			JSON.stringify({ authenticated: true, model: settings.GROQ_MODEL }),
		);
	} catch (error) {
		if (error instanceof HTTPError)
			console.error(`groq_http_${error.response.status}`);
		else if (error instanceof Error) console.error("groq_connection_failed");
		else throw error;
		process.exitCode = 1;
	}
}
