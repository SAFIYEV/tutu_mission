const CBR_DAILY_URL = "https://www.cbr.ru/scripts/XML_daily.asp";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type BudgetIntent = {
  amount: number;
  currency: string;
};

export type BudgetConversion = {
  originalAmount: number;
  originalCurrency: string;
  rubAmount: number;
  rateRubPerUnit: number;
  rateDate: string;
  sourceUrl: string;
};

type RateTable = {
  fetchedAt: number;
  rateDate: string;
  rates: Map<string, number>;
};

let cachedRates: RateTable | null = null;

export class CurrencyRateUnavailableError extends Error {
  readonly code = "CURRENCY_RATE_UNAVAILABLE";

  constructor(message = "Не удалось получить актуальный официальный курс валют. Повторите запрос позже.") {
    super(message);
    this.name = "CurrencyRateUnavailableError";
  }
}

const CURRENCY_ALIASES: Array<[RegExp, string]> = [
  [/(?:₽|RUB|руб(?:ль|ля|лей|\.)?)/i, "RUB"],
  [/(?:₼|AZN|манат(?:а|ов|ы)?)/i, "AZN"],
  [/(?:\$|USD|доллар(?:а|ов|ы)?)/i, "USD"],
  [/(?:€|EUR|евро)/i, "EUR"],
  [/(?:GEL|лари)/i, "GEL"],
  [/(?:TRY|лир(?:а|ы)?)/i, "TRY"],
  [/(?:GBP|фунт(?:а|ов)?(?:\s+стерлингов)?)/i, "GBP"],
  [/(?:KZT|тенге)/i, "KZT"],
  [/(?:AMD|драм(?:а|ов|ы)?)/i, "AMD"],
  [/(?:AED|дирхам(?:а|ов|ы)?)/i, "AED"],
  [/(?:CNY|юан(?:ь|я|ей))/i, "CNY"],
];

function parseAmount(value: string) {
  const compact = value.replace(/\s/g, "");
  const separator = Math.max(compact.lastIndexOf(","), compact.lastIndexOf("."));
  if (separator < 0) return Number(compact);
  const decimalDigits = compact.length - separator - 1;
  if (decimalDigits > 0 && decimalDigits <= 2) {
    return Number(`${compact.slice(0, separator).replace(/[.,]/g, "")}.${compact.slice(separator + 1)}`);
  }
  return Number(compact.replace(/[.,]/g, ""));
}

export function extractBudgetIntent(text: string): BudgetIntent | null {
  const budget = text.match(/(?:бюджет(?:ом)?(?:\s+до)?|не\s+дороже|до)\s*(\d[\d\s.,]*?)\s*(₽|₼|\$|€|[A-Z]{3}|руб(?:ль|ля|лей|\.)?|манат(?:а|ов|ы)?|доллар(?:а|ов|ы)?|евро|лари|лир(?:а|ы)?|фунт(?:а|ов)?(?:\s+стерлингов)?|тенге|драм(?:а|ов|ы)?|дирхам(?:а|ов|ы)?|юан(?:ь|я|ей))/i);
  if (!budget) return null;
  const amount = parseAmount(budget[1]);
  const token = budget[2];
  const currency = CURRENCY_ALIASES.find(([pattern]) => pattern.test(token))?.[1]
    ?? (/^[A-Z]{3}$/i.test(token) ? token.toUpperCase() : null);
  if (!currency || !Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency };
}

function parseRateTable(xml: string): RateTable {
  const rateDate = xml.match(/<ValCurs[^>]+Date="([^"]+)"/)?.[1];
  if (!rateDate) throw new CurrencyRateUnavailableError();
  const rates = new Map<string, number>([["RUB", 1]]);
  for (const block of xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g)) {
    const code = block[1].match(/<CharCode>([^<]+)<\/CharCode>/)?.[1];
    const nominal = Number(block[1].match(/<Nominal>([^<]+)<\/Nominal>/)?.[1]);
    const value = Number(block[1].match(/<Value>([^<]+)<\/Value>/)?.[1]?.replace(",", "."));
    if (code && nominal > 0 && Number.isFinite(value)) rates.set(code, value / nominal);
  }
  return { fetchedAt: Date.now(), rateDate, rates };
}

async function getRateTable(fetcher: typeof fetch = fetch) {
  if (cachedRates && Date.now() - cachedRates.fetchedAt < CACHE_TTL_MS) return cachedRates;
  let response: Response;
  try {
    response = await fetcher(CBR_DAILY_URL, {
      signal: AbortSignal.timeout(6_000),
      headers: { Accept: "application/xml,text/xml" },
    });
  } catch {
    throw new CurrencyRateUnavailableError();
  }
  if (!response.ok) throw new CurrencyRateUnavailableError();
  const xml = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
  cachedRates = parseRateTable(xml);
  return cachedRates;
}

export async function convertBudgetToRub(intent: BudgetIntent, fetcher: typeof fetch = fetch): Promise<BudgetConversion> {
  if (intent.currency === "RUB") {
    return {
      originalAmount: intent.amount,
      originalCurrency: "RUB",
      rubAmount: Math.floor(intent.amount),
      rateRubPerUnit: 1,
      rateDate: new Intl.DateTimeFormat("ru-RU").format(new Date()),
      sourceUrl: CBR_DAILY_URL,
    };
  }
  const table = await getRateTable(fetcher);
  const rate = table.rates.get(intent.currency);
  if (!rate) throw new CurrencyRateUnavailableError(`Банк России не опубликовал курс ${intent.currency}. Укажите бюджет в рублях или другую поддерживаемую валюту.`);
  return {
    originalAmount: intent.amount,
    originalCurrency: intent.currency,
    rubAmount: Math.floor(intent.amount * rate),
    rateRubPerUnit: rate,
    rateDate: table.rateDate,
    sourceUrl: CBR_DAILY_URL,
  };
}

export function resetCurrencyRateCacheForTests() {
  cachedRates = null;
}
