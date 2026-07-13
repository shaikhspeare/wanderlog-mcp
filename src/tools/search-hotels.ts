import { z } from "zod";
import type { AppContext } from "../context.js";
import type {
  HotelAvailableFilters,
  HotelDeal,
  HotelGeo,
  HotelOffer,
  HotelPriceBucket,
  HotelSearchResult,
  LodgingAmenity,
  LodgingOffer,
  LodgingPriceRate,
  LodgingSearchResponse,
} from "../types.js";
import type { RestClient } from "../transport/rest.js";
import {
  WanderlogError,
  WanderlogValidationError,
} from "../errors.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SORT_VALUES = [
  "ratings",
  "price_low_to_high",
  "price_high_to_low",
  "deals",
] as const;

export const searchHotelsInputSchema = {
  destination: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Free-text destination (e.g. 'Pattaya', 'Tokyo Shinjuku'). The highest-popularity matching geo is picked; up to 2 alternatives are returned in 'alternative_geos' for the LLM to re-call with geo_id if needed.",
    ),
  geo_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Explicit Wanderlog geo id (usually obtained from a prior search's 'geo' or 'alternative_geos').",
    ),
  check_in: z
    .string()
    .regex(DATE_RE, "must be YYYY-MM-DD")
    .describe("Check-in date, YYYY-MM-DD."),
  check_out: z
    .string()
    .regex(DATE_RE, "must be YYYY-MM-DD")
    .describe("Check-out date, YYYY-MM-DD. Must be after check_in."),
  adult_count: z.number().int().min(1).default(2).describe("Number of adults."),
  room_count: z.number().int().min(1).default(1).describe("Number of rooms."),
  children_ages: z
    .array(z.number().int().min(0).max(17))
    .default([])
    .describe(
      "Ages of children. Wanderlog prices children by age, not count — pass each child's age (e.g. [4, 9]).",
    ),
  sort_by: z
    .enum(SORT_VALUES)
    .default("ratings")
    .describe("Result ordering."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum number of offers in the response."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe(
      "ISO 4217 currency code for prices (e.g. 'INR', 'USD', 'ARS'). Optional. When provided, the shared session's currency preference is updated before searching so all returned prices are in this currency. When omitted, prices are returned in the session's existing currency and no global preference is changed.",
    ),
  price_range: z
    .tuple([z.number().min(0), z.number().min(0)])
    .optional()
    .describe("[min, max] nightly price band in the response currency."),
  hotel_classes: z
    .array(z.number().int().min(1).max(5))
    .optional()
    .describe("Star ratings to keep, e.g. [4, 5]."),
  min_guest_rating: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .describe("Minimum guest review score (Wanderlog's 0-10 scale)."),
  lodging_types: z
    .array(z.string())
    .optional()
    .describe(
      "Lodging-type filter; values come from 'available_filters.lodging_types' in a prior response.",
    ),
  accommodation_types: z
    .array(z.string())
    .optional()
    .describe(
      "Accommodation-type filter; values come from 'available_filters.accommodation_types' in a prior response.",
    ),
  hotel_or_vacation_rental: z
    .enum(["hotel", "rental", "both"])
    .optional()
    .describe("Restrict to hotels, vacation rentals, or both."),
  amenities: z
    .array(z.string())
    .optional()
    .describe(
      "Required amenities; values come from 'available_filters.amenities' in a prior response.",
    ),
  min_beds_in_room: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Minimum beds per room."),
  property_name: z
    .string()
    .optional()
    .describe("Substring match against the property name."),
  vacation_rental_amenities: z
    .array(z.string())
    .optional()
    .describe(
      "Vacation-rental-specific amenities; values come from 'available_filters' in a prior response.",
    ),
  sources: z
    .array(z.string())
    .optional()
    .describe(
      "Override the default vendor set ['airbnb','expedia','google','kayak'].",
    ),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe(
      "Output verbosity. 'concise' returns essential fields (name, price, rating, deals, location). 'detailed' also includes amenities, hotel_class, lodging_type, accommodation_type, and thumbnail.",
    ),
};

export const searchHotelsDescription = `
Search Wanderlog's hotel aggregator (airbnb, expedia, google, kayak) for a destination and
date range. Returns ranked offers with per-vendor deal comparison and an
available_filters facet block the LLM can use to narrow.

Specify exactly one of destination or geo_id. For free-text destinations the
highest-popularity match is picked; up to 2 candidates appear in alternative_geos as a soft
hint — re-call with one of those geo_ids if the wrong city was chosen.

Use response_format='detailed' to include amenities, hotel class, and property type on each
offer. The default 'concise' format omits those fields to keep token usage low.
`.trim();

export type SearchHotelsArgs = {
  destination?: string;
  geo_id?: number;
  check_in: string;
  check_out: string;
  adult_count?: number;
  room_count?: number;
  children_ages?: number[];
  sort_by?: (typeof SORT_VALUES)[number];
  limit?: number;
  currency?: string;
  price_range?: [number, number];
  hotel_classes?: number[];
  min_guest_rating?: number;
  lodging_types?: string[];
  accommodation_types?: string[];
  hotel_or_vacation_rental?: "hotel" | "rental" | "both";
  amenities?: string[];
  min_beds_in_room?: number;
  property_name?: string;
  vacation_rental_amenities?: string[];
  sources?: string[];
  response_format?: "concise" | "detailed";
};

export function validateArgs(args: SearchHotelsArgs): Required<
  Pick<
    SearchHotelsArgs,
    | "check_in"
    | "check_out"
    | "adult_count"
    | "room_count"
    | "children_ages"
    | "sort_by"
    | "limit"
  >
> &
  SearchHotelsArgs {
  const modesSet = [
    args.destination !== undefined,
    args.geo_id !== undefined,
  ].filter(Boolean).length;
  if (modesSet !== 1) {
    throw new WanderlogValidationError(
      "Pass exactly one of destination or geo_id.",
    );
  }
  if (args.check_out <= args.check_in) {
    throw new WanderlogValidationError(
      `check_out (${args.check_out}) must be after check_in (${args.check_in})`,
    );
  }
  return {
    ...args,
    adult_count: args.adult_count ?? 2,
    room_count: args.room_count ?? 1,
    children_ages: args.children_ages ?? [],
    sort_by: args.sort_by ?? "ratings",
    limit: args.limit ?? 10,
  };
}

export function buildSearchBody(
  args: SearchHotelsArgs,
  geo: HotelGeo,
): Parameters<RestClient["searchLodgings"]>[0] {
  if (!geo.bounds) {
    throw new WanderlogValidationError(
      `Geo ${geo.geo_id} (${geo.name}) has no bounds; cannot search lodgings.`,
    );
  }
  return {
    geoId: geo.geo_id,
    bounds: geo.bounds,
    startDate: args.check_in,
    endDate: args.check_out,
    adultCount: args.adult_count ?? 2,
    roomCount: args.room_count ?? 1,
    childrenAges: args.children_ages ?? [],
    sortBy: args.sort_by ?? "ratings",
    sources: args.sources,
    filters: {
      priceRange: args.price_range ?? null,
      hotelClasses: args.hotel_classes ?? null,
      minGuestRating: args.min_guest_rating ?? null,
      propertyTypes: {
        lodgingTypes: args.lodging_types ?? null,
        accommodationTypes: args.accommodation_types ?? null,
      },
      hotelOrVacationRental: args.hotel_or_vacation_rental ?? "both",
      amenities: args.amenities ?? null,
      minBedsInRoom: args.min_beds_in_room ?? null,
      propertyName: args.property_name ?? "",
      vacationRentalFilters: {
        amenities: args.vacation_rental_amenities ?? [],
      },
    },
  };
}

function pickPrimaryDeal(rates: LodgingPriceRate[]): LodgingPriceRate {
  return rates.reduce((cheapest, r) =>
    r.amount < cheapest.amount ? r : cheapest,
  );
}

export function projectOffer(offer: LodgingOffer): HotelOffer {
  const rates =
    offer.priceRates && offer.priceRates.length > 0
      ? offer.priceRates
      : offer.priceRate
        ? [offer.priceRate]
        : [];
  if (rates.length === 0) {
    throw new WanderlogError(
      `Lodging offer ${offer.lodging.id.lodgingId} has no priceRate(s)`,
      "missing_price_rate",
    );
  }
  const primary = pickPrimaryDeal(rates);
  const deals: HotelDeal[] = rates.map((r) => ({
    vendor: r.site,
    price: r.amount,
    url: r.bookingUrl,
    free_cancellation: r.hasFreeCancellation ?? false,
    member_deal: r.hasMemberDeal ?? false,
  }));
  const prices = rates.map((r) => r.amount);
  // Wanderlog returns amenities as objects {name, category}; surface the name strings.
  const amenities = (offer.lodging.amenities ?? []).map(
    (a: LodgingAmenity) => a.name,
  );
  return {
    name: offer.lodging.name,
    url: primary.bookingUrl,
    rating: offer.lodging.rating?.value ?? null,
    rating_count: offer.lodging.ratingCount ?? null,
    price_min: Math.min(...prices),
    price_max: Math.max(...prices),
    currency: primary.currencyCode,
    location: {
      lat: offer.lodging.location.latitude,
      lng: offer.lodging.location.longitude,
    },
    thumbnail: offer.lodging.images?.[0]?.thumbnailUrl ?? null,
    deals,
    amenities,
    hotel_class: offer.lodging.hotelClass ?? null,
    lodging_type: offer.lodging.lodgingType ?? null,
    accommodation_type: offer.lodging.accommodationType ?? null,
  };
}

function inc(map: Record<string, number>, key: string | undefined): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

function quartileBuckets(prices: number[]): HotelPriceBucket[] {
  if (prices.length === 0) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0]!;
  const q1 = sorted[Math.floor(n * 0.25)] ?? min;
  const q2 = sorted[Math.floor(n * 0.5)] ?? min;
  const q3 = sorted[Math.floor(n * 0.75)] ?? min;
  const ranges: Array<[number, number | null]> = [
    [min, q1],
    [q1, q2],
    [q2, q3],
    [q3, null],
  ];
  return ranges.map(([lo, hi], idx, all) => {
    if (idx === all.length - 1) {
      return {
        min: lo,
        max: hi,
        count: prices.filter((p) => p >= lo).length,
      };
    }
    return {
      min: lo,
      max: hi,
      count: prices.filter((p) => {
        if (hi === null) return p >= lo;
        return p >= lo && p < hi;
      }).length,
    };
  });
}

export function aggregateFacets(
  offers: LodgingOffer[],
): HotelAvailableFilters {
  const hotelClasses: Record<string, number> = {};
  const amenities: Record<string, number> = {};
  const lodgingTypes: Record<string, number> = {};
  const accommodationTypes: Record<string, number> = {};
  const sources: Record<string, number> = {};

  for (const offer of offers) {
    if (typeof offer.lodging.hotelClass === "number") {
      inc(hotelClasses, String(offer.lodging.hotelClass));
    }
    for (const a of offer.lodging.amenities ?? []) inc(amenities, a.name);
    inc(lodgingTypes, offer.lodging.lodgingType);
    inc(accommodationTypes, offer.lodging.accommodationType);

    const rates =
      offer.priceRates && offer.priceRates.length > 0
        ? offer.priceRates
        : offer.priceRate
          ? [offer.priceRate]
          : [];
    const sitesInThisOffer = new Set<string>();
    for (const r of rates) sitesInThisOffer.add(r.site);
    for (const site of sitesInThisOffer) inc(sources, site);
  }

  const primaryPrices = offers
    .map((o) => o.priceRates?.[0]?.amount ?? o.priceRate?.amount)
    .filter((p): p is number => p !== undefined);

  return {
    hotel_classes: hotelClasses,
    amenities,
    lodging_types: lodgingTypes,
    accommodation_types: accommodationTypes,
    sources,
    price_buckets: quartileBuckets(primaryPrices),
  };
}

export async function resolveGeo(
  ctx: AppContext,
  args: Pick<SearchHotelsArgs, "destination" | "geo_id">,
): Promise<{ geo: HotelGeo; alternative_geos: HotelGeo[] }> {
  if (args.geo_id !== undefined) {
    const g = await ctx.rest.getGeo(args.geo_id);
    return {
      geo: {
        geo_id: g.id,
        name: g.name,
        country: g.countryName ?? null,
        bounds: g.bounds ?? null,
      },
      alternative_geos: [],
    };
  }
  const candidates = await ctx.rest.geoAutocomplete(args.destination!);
  if (candidates.length === 0) {
    throw new WanderlogError(
      `No geo found matching "${args.destination}"`,
      "destination_not_found",
      {
        hint: "Try a more specific name (include the country) or pass an explicit geo_id from a prior search.",
        followUps: [
          "Retry wanderlog_search_hotels with a more specific destination string (include the country or region).",
        ],
      },
    );
  }
  const ranked = [...candidates].sort(
    (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0),
  );
  const top = ranked[0]!;
  const alternatives = ranked.slice(1, 3).map((c) => ({
    geo_id: c.id,
    name: c.name,
    country: c.countryName ?? null,
    bounds: c.bounds ?? null,
  }));
  return {
    geo: {
      geo_id: top.id,
      name: top.name,
      country: top.countryName ?? null,
      bounds: top.bounds ?? null,
    },
    alternative_geos: alternatives,
  };
}

const POLL_INTERVAL_MS = 800;
const POLL_MAX_RETRIES = 3;

export async function pollSearch(opts: {
  fetchPage: () => Promise<LodgingSearchResponse>;
  limit: number;
  maxRetries: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<{ offers: LodgingOffer[]; complete: boolean }> {
  let lastResult: LodgingSearchResponse | null = null;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    lastResult = await opts.fetchPage();
    if (lastResult.isComplete || lastResult.offers.length >= opts.limit) {
      return { offers: lastResult.offers, complete: lastResult.isComplete };
    }
    if (attempt < opts.maxRetries) {
      await opts.sleep(POLL_INTERVAL_MS);
    }
  }
  return {
    offers: lastResult?.offers ?? [],
    complete: lastResult?.isComplete ?? false,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applied(args: SearchHotelsArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (args.price_range) out.price_range = args.price_range;
  if (args.hotel_classes) out.hotel_classes = args.hotel_classes;
  if (args.min_guest_rating !== undefined)
    out.min_guest_rating = args.min_guest_rating;
  if (args.lodging_types) out.lodging_types = args.lodging_types;
  if (args.accommodation_types)
    out.accommodation_types = args.accommodation_types;
  if (args.hotel_or_vacation_rental)
    out.hotel_or_vacation_rental = args.hotel_or_vacation_rental;
  if (args.amenities) out.amenities = args.amenities;
  if (args.min_beds_in_room !== undefined)
    out.min_beds_in_room = args.min_beds_in_room;
  if (args.property_name) out.property_name = args.property_name;
  if (args.vacation_rental_amenities)
    out.vacation_rental_amenities = args.vacation_rental_amenities;
  if (args.sources) out.sources = args.sources;
  return out;
}

export async function searchHotels(
  ctx: AppContext,
  args: SearchHotelsArgs,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const norm = validateArgs(args);
    const { geo, alternative_geos } = await resolveGeo(ctx, norm);
    // WHY: currencyPreference is stored on the SHARED server-side Wanderlog
    // session (POST /api/sessionStore), so setting it mutates global state for
    // every other caller using this cookie — not just this search. Only mutate
    // it when the caller explicitly asks for a currency; a default search must
    // not silently change the session's currency preference. When no currency
    // is passed, prices come back in whatever the session already uses, and we
    // label the response from the offers' own currencyCode below.
    if (norm.currency) {
      await ctx.rest.setCurrencyPreference(norm.currency);
    }
    const body = buildSearchBody(norm, geo);

    const { offers, complete } = await pollSearch({
      fetchPage: () => ctx.rest.searchLodgings(body),
      limit: norm.limit,
      maxRetries: POLL_MAX_RETRIES,
      sleep: defaultSleep,
    });

    const projected = offers.map(projectOffer);
    const sliced = projected.slice(0, norm.limit);
    const facets = aggregateFacets(offers);
    const currency =
      norm.currency ??
      projected[0]?.currency ??
      ctx.config.defaultCurrency ??
      "USD";

    const format = norm.response_format ?? "concise";
    const offersForWire =
      format === "concise"
        ? sliced.map(
            ({
              amenities: _a,
              hotel_class: _hc,
              lodging_type: _lt,
              accommodation_type: _at,
              thumbnail: _t,
              ...rest
            }) => rest,
          )
        : sliced;

    const result: HotelSearchResult = {
      geo,
      alternative_geos,
      currency,
      complete,
      total_results: offers.length,
      returned: sliced.length,
      applied_filters: applied(norm),
      available_filters: facets,
      offers: offersForWire as HotelOffer[],
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const e =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: e }], isError: true };
  }
}
