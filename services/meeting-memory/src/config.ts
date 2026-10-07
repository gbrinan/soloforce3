import { z } from "zod";
export const Config = z.object({
	FFMPEG_PATH: z.string().default("ffmpeg"),
	GEMINI_CLI_ENTRY: z.string().default(""),
	GEMINI_CLI_MODEL: z.string().default(""),
	GEMINI_CLI_TIMEOUT_MS: z.coerce.number().int().positive().default(600000),
	SERVICE_TOKEN: z.string().min(24),
	PORT: z.coerce.number().int().min(1).max(65535).default(8787),
	DATA_DIR: z.string().default("./data"),
	HOST: z.string().default("127.0.0.1"),
	ANTHROPIC_API_KEY: z.string().optional(),
	CLAUDE_MODEL: z.string().default("claude-sonnet-4-6"),
	TRANSCRIBER: z
		.enum(["groq", "whisper", "gemini", "gemini-cli"])
		.default("groq"),
	WHISPER_URL: z
		.string()
		.url()
		.default("http://127.0.0.1:8000/v1/audio/transcriptions"),
	WHISPER_MODEL: z.string().default("Systran/faster-whisper-small"),
	WHISPER_KEY: z.string().optional(),
	GEMINI_API_KEY: z.string().optional(),
	GROQ_API_KEY: z.string().optional(),
	GROQ_MODEL: z.string().default("whisper-large-v3"),
	GEMINI_SUMMARY_MODEL: z.string().default("gemini-2.5-flash"),
	GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	GOOGLE_REFRESH_TOKEN: z.string().optional(),
	DRIVE_FOLDER_ID: z.string().optional(),
	TELEGRAM_BOT_TOKEN: z.string().optional(),
	TELEGRAM_CHAT_ID: z.string().optional(),
	STYLE_PATH: z.string().default("./examples/style.md"),
});
export type Settings = z.infer<typeof Config>;
