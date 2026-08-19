import type { HotelOption, MissionConstraints, TransportMode, TransportOption } from "@/lib/mission/schema";
import type { MissionSearchProvider, MissionSearchResult, SearchDirectionResult } from "@/lib/mission/ports";
import { cityTimeZone, isoInTimeZone } from "@/lib/mission/timezone";
import { TutuMcpClient } from "./client";
import { integerEnv } from "@/lib/runtime-config";

type RawVariant = {
  offer_id?: string;
  transport?: TransportMode;
  price?: { amount?: number; currency?: string };
  duration_min?: number;
  segments_count?: number;
  departure_at?: string;
  arrival_at?: string;
  carriers?: string[];
  checkout_url?: string;
  search_results_url?: string;
  legs?: Array<{ from?: string; to?: string; segments?: unknown[] }>;
};

type MultiResponse = {
  variants?: RawVariant[];
  meta?: {
    unavailable?: Array<{ mode?: TransportMode } | TransportMode>;
    has_more?: boolean;
    truncated?: boolean;
    cache_status?: "stale-if-error";
    cached_at?: string;
  };
};

type RawHotel = {
  hotel_id?: string | number;
  hotel_geo_id?: string | number;
  name?: string;
  stars?: number;
  rating?: number;
  review_count?: number;
  address?: string;
  photos?: string[];
  checkout_url?: string;
  best_offer?: {
    price?: { amount?: number; currency?: string };
    checkout_url?: string;
    breakfast_included?: boolean | null;
    free_cancellation?: boolean | null;
  };
};

type HotelResponse = {
  hotels?: RawHotel[];
  stay?: { check_in?: string; check_out?: string; nights?: number };
  meta?: { has_more?: boolean; cache_status?: "stale-if-error"; cached_at?: string };
};

export class TutuSearchUnavailableError extends Error {
  readonly code = "TUTU_MCP_UNAVAILABLE";

  constructor(readonly warnings: string[]) {
    super("Туту временно не вернул данные. Попробуйте решить задачу ещё раз.");
    this.name = "TutuSearchUnavailableError";
  }
}

function datePart(iso: string) {
  return iso.slice(0, 10);
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function normalize(raw: RawVariant): TransportOption | null {
  const leg = raw.legs?.[0];
  if (!raw.offer_id || !raw.transport || !raw.departure_at || !raw.arrival_at || raw.price?.amount == null) return null;
  return {
    id: raw.offer_id,
    mode: raw.transport,
    price: raw.price.amount,
    currency: raw.price.currency ?? "RUB",
    departureAt: raw.departure_at,
    arrivalAt: raw.arrival_at,
    durationMin: raw.duration_min ?? Math.round((new Date(raw.arrival_at).getTime() - new Date(raw.departure_at).getTime()) / 60_000),
    transfers: Math.max(0, (raw.segments_count ?? leg?.segments?.length ?? 1) - 1),
    carrier: raw.carriers?.join(", ") ?? null,
    from: leg?.from ?? "Станция отправления",
    to: leg?.to ?? "Станция прибытия",
    checkoutUrl: raw.checkout_url ?? null,
    searchResultsUrl: raw.search_results_url ?? null,
    source: "tutu-mcp",
  };
}

function normalizeHotel(raw: RawHotel, stay: HotelResponse["stay"]): HotelOption | null {
  const id = raw.hotel_geo_id ?? raw.hotel_id;
  const price = raw.best_offer?.price?.amount;
  const checkoutUrl = raw.best_offer?.checkout_url ?? raw.checkout_url;
  if (id == null || !raw.name || price == null || !checkoutUrl || !stay?.check_in || !stay.check_out || !stay.nights) return null;
  return {
    id: String(id),
    name: raw.name,
    stars: raw.stars ?? null,
    rating: raw.rating ?? null,
    reviewCount: raw.review_count ?? null,
    address: raw.address ?? null,
    checkIn: stay.check_in,
    checkOut: stay.check_out,
    nights: stay.nights,
    price,
    currency: raw.best_offer?.price?.currency ?? "RUB",
    breakfastIncluded: raw.best_offer?.breakfast_included ?? null,
    freeCancellation: raw.best_offer?.free_cancellation ?? null,
    checkoutUrl,
    photoUrl: raw.photos?.[0] ?? null,
    source: "tutu-mcp",
  };
}

export class TutuProvider implements MissionSearchProvider {
  constructor(
    private readonly client = new TutuMcpClient(),
    private readonly now = () => new Date(),
  ) {}

  private async search(origin: string, destination: string, date: string, adults: number, signal?: AbortSignal) {
    const combined: MultiResponse = { variants: [], meta: { unavailable: [], has_more: false } };
    const pageLimit = mcpPageLimit();
    for (let page = 1; page <= pageLimit; page += 1) {
      signal?.throwIfAborted();
      const response = await this.client.callTool<MultiResponse>("search_multitransport", {
        origin,
        destination,
        departure_date: date,
        adults,
        modes: ["avia", "railway", "bus", "etrain"],
        optimize_for: "price",
        page,
        page_size: 30,
        // Keep over-budget offers for the Impossible Mission analyzer.
        // Budget remains a hard deterministic constraint in Mission Solver.
        price_max: null,
        view: "compact",
      }, signal);
      combined.variants!.push(...(response.variants ?? []));
      const unavailable = [...(combined.meta!.unavailable ?? []), ...(response.meta?.unavailable ?? [])];
      combined.meta!.unavailable = [...new Map(unavailable.map((item) => [typeof item === "string" ? item : item.mode, item])).values()];
      combined.meta!.has_more = Boolean(response.meta?.has_more);
      if (response.meta?.cache_status) {
        combined.meta!.cache_status = response.meta.cache_status;
        combined.meta!.cached_at = response.meta.cached_at;
      }
      if (page === pageLimit && response.meta?.has_more) combined.meta!.truncated = true;
      if (!response.meta?.has_more) break;
    }
    return combined;
  }

  private async searchHotels(constraints: MissionConstraints, signal?: AbortSignal) {
    const accommodation = constraints.accommodation;
    if (!accommodation) return null;
    return this.client.callTool<HotelResponse>("search_hotels", {
      city_name: constraints.destination,
      check_in: accommodation.checkIn,
      check_out: accommodation.checkOut,
      adults: constraints.passengers.adults,
      children_ages: null,
      page: 1,
      page_size: 20,
      stars: accommodation.stars,
      min_rating: accommodation.minRating,
      breakfast_included: accommodation.breakfastIncluded,
      free_cancellation: accommodation.freeCancellation,
      hotel_types: accommodation.hotelTypes,
      price_max: null,
      view: "compact",
    }, signal);
  }

  async searchForMission(constraints: MissionConstraints, signal?: AbortSignal): Promise<MissionSearchResult> {
    const eventDate = datePart(constraints.eventAt);
    const now = this.now();
    const today = now.toISOString().slice(0, 10);
    const defaultLookback = integerEnv("TUTU_SEARCH_LOOKBACK_DAYS", 3, { min: 1, max: 7 });
    const horizonDays = constraints.maxTripDurationMin == null
      ? defaultLookback
      : Math.max(1, Math.min(7, Math.ceil(constraints.maxTripDurationMin / 1440)));
    const horizonStart = addDays(eventDate, -horizonDays);
    const outboundStart = horizonStart > today ? horizonStart : today;
    const outboundDates = datesBetween(outboundStart, eventDate);
    const returnDates = constraints.returnArrivalDeadline ? datesBetween(eventDate, datePart(constraints.returnArrivalDeadline)) : [];
    const jobs = [
      ...outboundDates.map((date) => ({ direction: "outbound" as const, date, run: () => this.search(constraints.origin, constraints.destination, date, constraints.passengers.adults, signal) })),
      ...returnDates.map((date) => ({ direction: "return" as const, date, run: () => this.search(constraints.destination, constraints.origin, date, constraints.passengers.adults, signal) })),
    ];
    const hotelSearch = constraints.accommodation
      ? this.searchHotels(constraints, signal).then(
        (value) => ({ value, error: null as unknown }),
        (error: unknown) => ({ value: null, error }),
      )
      : Promise.resolve({ value: null, error: null as unknown });
    const concurrency = integerEnv("TUTU_MCP_CONCURRENCY", 2, { min: 1, max: 4 });
    const settled: PromiseSettledResult<MultiResponse>[] = new Array(jobs.length);
    let nextJob = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (nextJob < jobs.length) {
        signal?.throwIfAborted();
        const index = nextJob++;
        try {
          settled[index] = { status: "fulfilled", value: await jobs[index].run() };
        } catch (reason) {
          if (signal?.aborted) throw reason;
          settled[index] = { status: "rejected", reason };
        }
      }
    }));
    const result = {
      outbound: { options: [], unavailableModes: [], warnings: [], attempts: outboundDates.length, successfulSearches: 0 } as SearchDirectionResult,
      returns: { options: [], unavailableModes: [], warnings: [], attempts: returnDates.length, successfulSearches: 0 } as SearchDirectionResult,
    };
    settled.forEach((entry, index) => {
      const job = jobs[index];
      const target = job.direction === "outbound" ? result.outbound : result.returns;
      if (entry.status === "rejected") {
        target.warnings.push(`${job.date}: ${entry.reason instanceof Error ? entry.reason.message : "MCP недоступен"}`);
        return;
      }
      const unavailableForResponse = (entry.value.meta?.unavailable ?? [])
        .map((item) => (typeof item === "string" ? item : item.mode))
        .filter(Boolean);
      if (unavailableForResponse.length < 4) target.successfulSearches += 1;
      else target.warnings.push(`${job.date}: все виды транспорта временно недоступны`);
      if (entry.value.meta?.cache_status === "stale-if-error") {
        target.warnings.push(`${job.date}: использован последний успешный ответ Туту${entry.value.meta.cached_at ? ` от ${entry.value.meta.cached_at}` : ""}`);
      }
      target.options.push(...(entry.value.variants ?? []).map(normalize).filter((option): option is TransportOption => Boolean(option)));
      if (entry.value.meta?.truncated) target.warnings.push(`${job.date}: выдача ограничена первыми ${pageLimitLabel()} страницами`);
      for (const item of entry.value.meta?.unavailable ?? []) {
        const mode = typeof item === "string" ? item : item.mode;
        if (mode && !target.unavailableModes.includes(mode)) target.unavailableModes.push(mode);
      }
    });
    result.outbound.options = [...new Map(result.outbound.options.map((option) => [option.id, option])).values()];
    result.returns.options = [...new Map(result.returns.options.map((option) => [option.id, option])).values()];
    const nowMs = now.getTime();
    const originZone = cityTimeZone(constraints.origin);
    const destinationZone = cityTimeZone(constraints.destination);
    result.outbound.options = result.outbound.options
      .filter((option) => new Date(option.departureAt).getTime() >= nowMs)
      .map((option) => ({
        ...option,
        departureAt: isoInTimeZone(option.departureAt, originZone),
        arrivalAt: isoInTimeZone(option.arrivalAt, destinationZone),
      }));
    result.returns.options = result.returns.options
      .filter((option) => new Date(option.departureAt).getTime() >= nowMs)
      .map((option) => ({
        ...option,
        departureAt: isoInTimeZone(option.departureAt, destinationZone),
        arrivalAt: isoInTimeZone(option.arrivalAt, originZone),
      }));
    let hotelResult: HotelResponse | null = null;
    if (constraints.accommodation) {
      const settledHotel = await hotelSearch;
      if (settledHotel.error) throw new TutuSearchUnavailableError([`Отели: ${settledHotel.error instanceof Error ? settledHotel.error.message : "MCP недоступен"}`]);
      hotelResult = settledHotel.value;
    }
    const outboundUnavailable = result.outbound.attempts > 0 && result.outbound.successfulSearches === 0;
    const returnUnavailable = returnDates.length > 0 && result.returns.successfulSearches === 0;
    if (outboundUnavailable || returnUnavailable) {
      throw new TutuSearchUnavailableError([...result.outbound.warnings, ...result.returns.warnings]);
    }
    return {
      ...result,
      hotels: constraints.accommodation ? {
        options: (hotelResult?.hotels ?? []).map((hotel) => normalizeHotel(hotel, hotelResult?.stay)).filter((hotel): hotel is HotelOption => Boolean(hotel)),
        warnings: hotelResult?.meta?.cache_status === "stale-if-error"
          ? [`Отели: использован последний успешный ответ Туту${hotelResult.meta.cached_at ? ` от ${hotelResult.meta.cached_at}` : ""}`]
          : [],
        attempts: 1,
        successfulSearches: 1,
      } : undefined,
    };
  }
}

function pageLimitLabel() {
  return mcpPageLimit();
}

function mcpPageLimit() {
  return integerEnv("TUTU_MCP_MAX_PAGES", 2, { min: 1, max: 10 });
}
