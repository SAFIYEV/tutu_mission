import { integerEnv } from "@/lib/runtime-config";

const DEFAULT_ENDPOINT = "https://mcp.tutu.ru/mcp";

type McpEnvelope = {
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  error?: { message?: string };
};

type CacheEntry = {
  storedAt: number;
  value: unknown;
};

type ClientOptions = {
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  freshCacheMs?: number;
  staleCacheMs?: number;
  maxAttempts?: number;
};

/**
 * A small, process-local resilience boundary around the public Tutu MCP.
 * The cache only contains actual MCP responses and is used stale only when
 * the upstream is temporarily unavailable.
 */
export class TutuMcpClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  private readonly sleep: NonNullable<ClientOptions["sleep"]>;
  private readonly freshCacheMs: number;
  private readonly staleCacheMs: number;
  private readonly configuredMaxAttempts?: number;

  constructor(
    private readonly endpoint = process.env.TUTU_MCP_URL ?? DEFAULT_ENDPOINT,
    private readonly fetcher: typeof fetch = fetch,
    options: ClientOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? abortableDelay;
    this.freshCacheMs = options.freshCacheMs ?? integerEnv("TUTU_MCP_CACHE_TTL_MS", 120_000, { min: 0, max: 10 * 60_000 });
    this.staleCacheMs = options.staleCacheMs ?? integerEnv("TUTU_MCP_STALE_TTL_MS", 20 * 60_000, { min: 0, max: 24 * 60 * 60_000 });
    this.configuredMaxAttempts = options.maxAttempts;
  }

  async callTool<T>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const key = `${this.endpoint}:${name}:${stableSerialize(args)}`;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.storedAt <= this.freshCacheMs) return clone(cached.value) as T;

    const shared = this.inFlight.get(key);
    if (shared) return awaitWithAbort(shared, signal).then((value) => clone(value) as T);

    const operation = this.fetchWithRetry<T>(name, args)
      .then((value) => {
        this.cache.set(key, { storedAt: this.now(), value: clone(value) });
        this.pruneCache();
        return value;
      })
      .catch((error: unknown) => {
        const fallback = this.cache.get(key);
        if (fallback && this.now() - fallback.storedAt <= this.staleCacheMs) {
          return markAsStale(clone(fallback.value), fallback.storedAt) as T;
        }
        throw error;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, operation);
    return awaitWithAbort(operation, signal).then((value) => clone(value) as T);
  }

  private pruneCache() {
    const oldestAllowed = this.now() - this.staleCacheMs;
    for (const [key, entry] of this.cache) {
      if (entry.storedAt < oldestAllowed) this.cache.delete(key);
    }
    while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
  }

  private async fetchWithRetry<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const maxAttempts = this.configuredMaxAttempts
      ?? integerEnv("TUTU_MCP_MAX_ATTEMPTS", 4, { min: 1, max: 6 });
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let retryAfterMs: number | null = null;
      try {
        const response = await this.fetcher(this.endpoint, {
          method: "POST",
          headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: args } }),
          signal: AbortSignal.timeout(integerEnv("TUTU_MCP_TIMEOUT_MS", 14_000, { min: 1_000, max: 60_000 })),
          cache: "no-store",
        });
        if (!response.ok) {
          const error = new Error(`Tutu MCP returned HTTP ${response.status}`);
          if (!isRetryableStatus(response.status)) throw error;
          retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
          throw Object.assign(error, { retryable: true });
        }
        const envelope = (await response.json()) as McpEnvelope;
        if (envelope.error) throw Object.assign(new Error(envelope.error.message ?? "Tutu MCP error"), { retryable: true });
        const text = envelope.result?.content?.find((item) => item.type === "text")?.text;
        if (!text || envelope.result?.isError) throw Object.assign(new Error(text ?? "Tutu MCP returned no data"), { retryable: true });
        const data = JSON.parse(text) as T;
        if (isTotalTransportOutage(data)) {
          throw Object.assign(new Error("Tutu MCP temporarily marked all transport modes unavailable"), { retryable: true });
        }
        return data;
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error) || attempt === maxAttempts) break;
        await this.sleep(retryAfterMs ?? retryDelay(attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Tutu MCP request failed");
  }
}

function isTotalTransportOutage(data: unknown) {
  if (!data || typeof data !== "object" || !("variants" in data) || !("meta" in data)) return false;
  const search = data as { variants?: unknown[]; meta?: { unavailable?: unknown[] } };
  return (search.variants?.length ?? 0) === 0 && (search.meta?.unavailable?.length ?? 0) >= 4;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown) {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")
    || error instanceof TypeError
    || error instanceof SyntaxError
    || Boolean(error && typeof error === "object" && "retryable" in error);
}

function retryDelay(attempt: number) {
  return Math.min(4_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 200);
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1_000));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.min(10_000, Math.max(0, timestamp - Date.now())) : null;
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => signal.addEventListener("abort", () => {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true })),
  ]);
}

function markAsStale(value: unknown, storedAt: number) {
  if (!value || typeof value !== "object" || !("meta" in value)) return value;
  const record = value as { meta?: Record<string, unknown> };
  record.meta = { ...record.meta, cache_status: "stale-if-error", cached_at: new Date(storedAt).toISOString() };
  return record;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
