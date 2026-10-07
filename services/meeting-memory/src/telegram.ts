import { z } from "zod";
import { http } from "./http";
export async function sendDocument(
	config: { readonly token: string; readonly chatId: string },
	id: string,
	markdown: string,
): Promise<void> {
	const text = markdown.split("## 4. 전문")[0] ?? markdown;
	const body = new FormData();
	body.set("chat_id", config.chatId);
	body.set("caption", `회의록 초안 · ${id.slice(0, 12)}`);
	body.set(
		"document",
		new Blob([text], { type: "text/plain;charset=utf-8" }),
		`meeting-${id.slice(0, 12)}.txt`,
	);
	z.object({ ok: z.literal(true) }).parse(
		await http
			.post(`https://api.telegram.org/bot${config.token}/sendDocument`, {
				body,
				retry: 0,
			})
			.json(),
	);
}
