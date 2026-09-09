/**
 * Minimal Telegram entrypoint for tmission.
 *
 * It keeps polling isolated from Next.js and fetches its production token from
 * encrypted AWS Parameter Store through the EC2 instance role.
 */

import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const miniAppUrl = process.env.TELEGRAM_MINI_APP_URL ?? "https://mission.matrixon.org";

if (!URL.canParse(miniAppUrl) || !miniAppUrl.startsWith("https://")) {
  throw new Error("TELEGRAM_MINI_APP_URL must be an HTTPS URL.");
}

async function resolveToken() {
  const directToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (directToken) return directToken;

  const parameterName = process.env.TELEGRAM_BOT_TOKEN_SSM_PARAMETER?.trim();
  if (!parameterName) {
    throw new Error("Set TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN_SSM_PARAMETER.");
  }

  const client = new SSMClient({ region: process.env.AWS_REGION ?? "eu-central-1" });
  const response = await client.send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }));
  const parameterToken = response.Parameter?.Value?.trim();

  if (!parameterToken) {
    throw new Error("Telegram bot token parameter is empty.");
  }

  return parameterToken;
}

const token = await resolveToken();

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
      text: "Открыть tmission",
      web_app: { url: miniAppUrl },
    }]],
  };
}

async function welcome(chatId, firstName) {
  const name = typeof firstName === "string" && firstName.trim() ? `, ${firstName.trim()}` : "";
  await telegram("sendMessage", {
    chat_id: chatId,
    text: `Привет${name}! 👋\n\nЯ помогу решить travel-задачу: сформулируйте цель поездки, а tmission найдёт и проверит выполнимый маршрут.`,
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
    commands: [{ command: "start", description: "Открыть tmission" }],
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
console.log("tmission Telegram bot is running.");
await pollForever();
