/**
 * Minimal Telegram entrypoint for Tutu Mission.
 *
 * It intentionally uses the built-in Node.js fetch API, so the bot does not
 * add a runtime dependency or share a process with the Next.js application.
 * Keep TELEGRAM_BOT_TOKEN in the service environment, never in this file.
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const miniAppUrl = process.env.TELEGRAM_MINI_APP_URL ?? "https://mission.matrixon.org";

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required to start the Telegram bot.");
}

if (!URL.canParse(miniAppUrl) || !miniAppUrl.startsWith("https://")) {
  throw new Error("TELEGRAM_MINI_APP_URL must be an HTTPS URL.");
}

const apiBase = `https://api.telegram.org/bot${token}`;
let nextOffset = 0;
let stopped = false;

async function telegram(method, payload = {}) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(55_000),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(`Telegram ${method} failed (${response.status}): ${body?.description ?? "unknown error"}`);
  }

  return body.result;
}

function welcomeKeyboard() {
  return {
    inline_keyboard: [[{
      text: "Открыть Tutu Mission",
      web_app: { url: miniAppUrl },
    }]],
  };
}

async function welcome(chatId, firstName) {
  const name = typeof firstName === "string" && firstName.trim() ? `, ${firstName.trim()}` : "";
  await telegram("sendMessage", {
    chat_id: chatId,
    text: `Привет${name}! 👋\n\nЯ помогу решить travel-задачу: сформулируйте цель поездки, а Tutu Mission найдёт и проверит выполнимый маршрут.`,
    reply_markup: welcomeKeyboard(),
  });
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message?.chat?.id) return;

  if (message.text?.startsWith("/start") || message.text) {
    await welcome(message.chat.id, message.from?.first_name);
  }
}

async function initialize() {
  const webhook = await telegram("getWebhookInfo");
  if (webhook.url) {
    throw new Error("Webhook already configured for this bot. Remove it before using long polling.");
  }

  await telegram("setMyCommands", {
    commands: [{ command: "start", description: "Открыть Tutu Mission" }],
  });
}

async function pollForever() {
  let pauseMs = 1_000;

  while (!stopped) {
    try {
      const updates = await telegram("getUpdates", {
        offset: nextOffset,
        timeout: 45,
        allowed_updates: ["message"],
      });

      for (const update of updates) {
        nextOffset = update.update_id + 1;
        await handleUpdate(update);
      }

      pauseMs = 1_000;
    } catch (error) {
      if (stopped) break;
      console.error("Telegram polling error:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
      pauseMs = Math.min(pauseMs * 2, 30_000);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopped = true;
  });
}

await initialize();
console.log("Tutu Mission Telegram bot is running.");
await pollForever();
