import { spawn } from "node:child_process";
import { Config } from "./config";
import { prepareCli, subscriptionEnv } from "./gemini-cli";

const settings = Config.parse(process.env);
const paths = await prepareCli(settings);
const env = subscriptionEnv(paths.home);
delete env["NO_BROWSER"];
const child = spawn(
	"node",
	[settings.GEMINI_CLI_ENTRY, "--extensions", "none"],
	{ cwd: paths.root, env, stdio: "inherit", windowsHide: false },
);
child.on("error", () => {
	console.error("Gemini CLI could not start. Check GEMINI_CLI_ENTRY.");
	process.exitCode = 1;
});
child.on("close", (code) => {
	process.exitCode = code ?? 1;
});
