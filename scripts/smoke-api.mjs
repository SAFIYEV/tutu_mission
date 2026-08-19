const baseUrl = process.env.MISSION_BASE_URL ?? "http://localhost:3000";

const scenarios = [
  {
    name: "rail deadline",
    text: "Завтра к 20:30 мне нужно быть в Казани. Я нахожусь в Москве. Бюджет до 20 000 рублей, только поездом.",
  },
  {
    name: "international currency and return",
    text: "Завтра к 14:15 мне нужно быть в Екатеринбурге. Я нахожусь в Баку. Бюджет до 2000 манатов, без самолёта, вернуться следующим утром до 12:00.",
  },
  {
    name: "long distance flight",
    text: "Завтра к 13:00 мне нужно быть во Владивостоке. Я нахожусь в Москве. Бюджет до 60 000 рублей, только самолётом.",
  },
];

async function runMission(scenario, mode = "solve") {
  const requestId = `smoke-${scenario.name.replace(/\s+/g, "-")}-${mode}`;
  const response = await fetch(`${baseUrl}/api/mission`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mission-request-id": requestId },
    body: JSON.stringify({ text: scenario.text, mode }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${scenario.name}: HTTP ${response.status}: ${payload.error ?? "unknown error"}`);
  if (payload.status !== "complete" && payload.status !== "impossible") {
    throw new Error(`${scenario.name}: expected solved mission, received ${payload.status ?? payload.code ?? "unknown outcome"}`);
  }
  if (!payload.trace || payload.trace.requestId !== requestId) throw new Error(`${scenario.name}: missing correlation trace`);
  if (!Number.isFinite(payload.stats?.outboundOffers)) throw new Error(`${scenario.name}: invalid directional stats`);
  if (payload.status === "complete" && payload.verification?.verified !== true) throw new Error(`${scenario.name}: unverified complete mission`);
  return payload;
}

const results = [];
for (const scenario of scenarios) {
  let result = await runMission(scenario);
  const initialStatus = result.status;
  if (result.status === "impossible" && result.suggestion) result = await runMission(scenario, "auto-adjust");
  results.push({
    scenario: scenario.name,
    initialStatus,
    finalStatus: result.status,
    parser: result.parserSource,
    outbound: result.stats.outboundOffers,
    returns: result.stats.returnOffers,
    combinations: result.stats.combinations,
    adjustmentRounds: result.trace.adjustmentRounds,
    verified: result.verification?.verified ?? false,
  });
}

console.table(results);
