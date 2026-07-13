import { describe, expect, it } from "vitest";
import {
  aggregateFacets,
  buildSearchBody,
  pollSearch,
  projectOffer,
  searchHotels,
} from "../../src/tools/search-hotels.ts";
import type { LodgingOffer, LodgingSearchResponse } from "../../src/types.ts";
import type { AppContext } from "../../src/context.ts";

const GEO = {
  geo_id: 80,
  name: "Pattaya",
  country: "Thailand",
  bounds: [100.85, 12.77, 100.98, 13.0] as [number, number, number, number],
};

describe("buildSearchBody", () => {
  it("maps minimal args to the wire-format body", () => {
    const body = buildSearchBody(
      {
        check_in: "2026-06-01",
        check_out: "2026-06-03",
        destination: "Pattaya",
        adult_count: 2,
        room_count: 1,
        children_ages: [],
        sort_by: "ratings",
        limit: 10,
      },
      GEO,
    );
    expect(body.geoId).toBe(80);
    expect(body.bounds).toEqual([100.85, 12.77, 100.98, 13.0]);
    expect(body.startDate).toBe("2026-06-01");
    expect(body.endDate).toBe("2026-06-03");
    expect(body.adultCount).toBe(2);
    expect(body.roomCount).toBe(1);
    expect(body.childrenAges).toEqual([]);
    expect(body.sortBy).toBe("ratings");
    // sources is optional; the default lives in RestClient.searchLodgings,
    // so buildSearchBody may emit it as undefined or omit the key.
    expect(body.filters?.hotelOrVacationRental ?? "both").toBe("both");
  });

  it("passes through every filter when provided", () => {
    const body = buildSearchBody(
      {
        check_in: "2026-06-01",
        check_out: "2026-06-03",
        geo_id: 80,
        adult_count: 2,
        room_count: 1,
        children_ages: [4, 9],
        sort_by: "price_low_to_high",
        limit: 10,
        price_range: [50, 500],
        hotel_classes: [4, 5],
        min_guest_rating: 8,
        lodging_types: ["hotel"],
        accommodation_types: ["entire_place"],
        hotel_or_vacation_rental: "hotel",
        amenities: ["pool", "wifi"],
        min_beds_in_room: 2,
        property_name: "Hyatt",
        vacation_rental_amenities: ["kitchen"],
        sources: ["expedia"],
      },
      GEO,
    );
    expect(body.childrenAges).toEqual([4, 9]);
    expect(body.sortBy).toBe("price_low_to_high");
    expect(body.sources).toEqual(["expedia"]);
    expect(body.filters?.priceRange).toEqual([50, 500]);
    expect(body.filters?.hotelClasses).toEqual([4, 5]);
    expect(body.filters?.minGuestRating).toBe(8);
    expect(body.filters?.propertyTypes?.lodgingTypes).toEqual(["hotel"]);
    expect(body.filters?.propertyTypes?.accommodationTypes).toEqual([
      "entire_place",
    ]);
    expect(body.filters?.hotelOrVacationRental).toBe("hotel");
    expect(body.filters?.amenities).toEqual(["pool", "wifi"]);
    expect(body.filters?.minBedsInRoom).toBe(2);
    expect(body.filters?.propertyName).toBe("Hyatt");
    expect(body.filters?.vacationRentalFilters?.amenities).toEqual(["kitchen"]);
  });

  it("throws WanderlogValidationError if geo has no bounds", () => {
    expect(() =>
      buildSearchBody(
        {
          check_in: "2026-06-01",
          check_out: "2026-06-03",
          destination: "Pattaya",
        },
        { geo_id: 999, name: "Nowhere", country: null, bounds: null },
      ),
    ).toThrow(/no bounds/);
  });
});

function rate(
  amount: number,
  site: string,
  opts: { freeCancel?: boolean; member?: boolean } = {},
) {
  return {
    amount,
    currencyCode: "INR",
    site,
    bookingUrl: `https://example.com/${site.toLowerCase()}`,
    hasFreeCancellation: opts.freeCancel ?? false,
    hasMemberDeal: opts.member ?? false,
  };
}

describe("projectOffer", () => {
  it("computes price_min/max from priceRates and points url at the cheapest", () => {
    const offer: LodgingOffer = {
      lodging: {
        id: { type: "google", lodgingId: "abc" },
        name: "Test Hotel",
        rating: { source: "Google", value: 8.5 },
        ratingCount: 200,
        location: { latitude: 12.93, longitude: 100.91 },
        images: [{ url: "u", thumbnailUrl: "thumb" }],
      },
      priceRates: [
        rate(9345, "Expedia", { freeCancel: true }),
        rate(8872, "Google"),
        rate(11048, "Booking.com"),
      ],
    };
    const projected = projectOffer(offer);
    expect(projected.price_min).toBe(8872);
    expect(projected.price_max).toBe(11048);
    expect(projected.currency).toBe("INR");
    expect(projected.url).toBe("https://example.com/google");
    expect(projected.thumbnail).toBe("thumb");
    expect(projected.rating).toBe(8.5);
    expect(projected.rating_count).toBe(200);
    expect(projected.location).toEqual({ lat: 12.93, lng: 100.91 });
    expect(projected.deals).toHaveLength(3);
    expect(projected.deals.map((d) => d.vendor)).toEqual([
      "Expedia",
      "Google",
      "Booking.com",
    ]);
    expect(projected.deals[0]?.free_cancellation).toBe(true);
  });

  it("falls back to single priceRate when priceRates is missing", () => {
    const offer: LodgingOffer = {
      lodging: {
        id: { type: "google", lodgingId: "abc" },
        name: "Test Hotel",
        location: { latitude: 0, longitude: 0 },
      },
      priceRate: rate(5000, "Google"),
    };
    const projected = projectOffer(offer);
    expect(projected.price_min).toBe(5000);
    expect(projected.price_max).toBe(5000);
    expect(projected.deals).toHaveLength(1);
    expect(projected.url).toBe("https://example.com/google");
  });

  it("returns null for missing rating/rating_count/thumbnail", () => {
    const offer: LodgingOffer = {
      lodging: {
        id: { type: "google", lodgingId: "abc" },
        name: "Test Hotel",
        location: { latitude: 0, longitude: 0 },
      },
      priceRate: rate(5000, "Google"),
    };
    const projected = projectOffer(offer);
    expect(projected.rating).toBeNull();
    expect(projected.rating_count).toBeNull();
    expect(projected.thumbnail).toBeNull();
  });
});

function offerWith(args: {
  hotelClass?: number;
  amenities?: string[];
  lodgingType?: string;
  accommodationType?: string;
  rates: Array<{ amount: number; site: string }>;
}): LodgingOffer {
  return {
    lodging: {
      id: { type: "google", lodgingId: Math.random().toString() },
      name: "Test",
      location: { latitude: 0, longitude: 0 },
      hotelClass: args.hotelClass,
      amenities: args.amenities?.map((name) => ({ name, category: null })),
      lodgingType: args.lodgingType,
      accommodationType: args.accommodationType,
    },
    priceRates: args.rates.map((r) => ({
      amount: r.amount,
      currencyCode: "USD",
      site: r.site,
      bookingUrl: "u",
    })),
  };
}

describe("aggregateFacets", () => {
  it("counts hotel_classes, amenities, lodging_types, accommodation_types, sources", () => {
    const offers: LodgingOffer[] = [
      offerWith({
        hotelClass: 4,
        amenities: ["pool", "wifi"],
        lodgingType: "hotel",
        accommodationType: "entire_place",
        rates: [
          { amount: 100, site: "Google" },
          { amount: 110, site: "Expedia" },
        ],
      }),
      offerWith({
        hotelClass: 5,
        amenities: ["pool", "gym"],
        lodgingType: "hotel",
        accommodationType: "private_room",
        rates: [{ amount: 200, site: "Google" }],
      }),
      offerWith({
        hotelClass: 4,
        amenities: ["wifi"],
        lodgingType: "hostel",
        rates: [{ amount: 50, site: "Airbnb" }],
      }),
    ];
    const f = aggregateFacets(offers);
    expect(f.hotel_classes).toEqual({ "4": 2, "5": 1 });
    expect(f.amenities).toEqual({ pool: 2, wifi: 2, gym: 1 });
    expect(f.lodging_types).toEqual({ hotel: 2, hostel: 1 });
    expect(f.accommodation_types).toEqual({
      entire_place: 1,
      private_room: 1,
    });
    expect(f.sources).toEqual({ Google: 2, Expedia: 1, Airbnb: 1 });
  });

  it("computes 4 price quartile buckets over the price set", () => {
    const offers: LodgingOffer[] = Array.from({ length: 8 }, (_, i) =>
      offerWith({ rates: [{ amount: (i + 1) * 100, site: "Google" }] }),
    );
    const f = aggregateFacets(offers);
    expect(f.price_buckets).toHaveLength(4);
    expect(f.price_buckets[0]?.min).toBe(100);
    expect(f.price_buckets[3]?.max).toBeNull();
    const total = f.price_buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(8);
  });

  it("returns an empty/zero-valued facets shape for an empty offer list", () => {
    const f = aggregateFacets([]);
    expect(f.hotel_classes).toEqual({});
    expect(f.amenities).toEqual({});
    expect(f.lodging_types).toEqual({});
    expect(f.accommodation_types).toEqual({});
    expect(f.sources).toEqual({});
    expect(f.price_buckets).toEqual([]);
  });
});

function fakeCtx(overrides: Partial<AppContext["rest"]> = {}): AppContext {
  return {
    rest: {
      geoAutocomplete: async () => [],
      getGeo: async () => {
        throw new Error("getGeo not stubbed");
      },
      getTripWithResources: async () => {
        throw new Error("getTripWithResources not stubbed");
      },
      ...overrides,
    },
  } as unknown as AppContext;
}

describe("resolveGeo", () => {
  it("auto-picks highest-popularity candidate and returns top 2 as alternatives", async () => {
    const { resolveGeo } = await import("../../src/tools/search-hotels.ts");
    const ctx = fakeCtx({
      geoAutocomplete: async () => [
        { id: 1, name: "Pattaya", countryName: "USA", popularity: 5, latitude: 0, longitude: 0 },
        {
          id: 2,
          name: "Pattaya",
          countryName: "Thailand",
          popularity: 95,
          latitude: 0,
          longitude: 0,
          bounds: [1, 2, 3, 4] as [number, number, number, number],
        },
        { id: 3, name: "Pattaya Beach", countryName: "Thailand", popularity: 50, latitude: 0, longitude: 0 },
      ],
    });
    const result = await resolveGeo(ctx, { destination: "Pattaya" });
    expect(result.geo.geo_id).toBe(2);
    expect(result.geo.country).toBe("Thailand");
    expect(result.geo.bounds).toEqual([1, 2, 3, 4]);
    expect(result.alternative_geos.map((g: { geo_id: number }) => g.geo_id)).toEqual([3, 1]);
  });

  it("throws destination_not_found when geoAutocomplete returns []", async () => {
    const { resolveGeo } = await import("../../src/tools/search-hotels.ts");
    const ctx = fakeCtx({ geoAutocomplete: async () => [] });
    await expect(resolveGeo(ctx, { destination: "NowhereLand" })).rejects.toMatchObject({
      code: "destination_not_found",
    });
  });

  it("uses getGeo for explicit geo_id", async () => {
    const { resolveGeo } = await import("../../src/tools/search-hotels.ts");
    const ctx = fakeCtx({
      getGeo: async (id: number) => ({
        id,
        name: "Pattaya",
        countryName: "Thailand",
        bounds: [10, 20, 30, 40] as [number, number, number, number],
      }),
    });
    const result = await resolveGeo(ctx, { geo_id: 80 });
    expect(result.geo.geo_id).toBe(80);
    expect(result.geo.bounds).toEqual([10, 20, 30, 40]);
    expect(result.alternative_geos).toEqual([]);
  });
});

function makeOffer(name: string): LodgingOffer {
  return {
    lodging: {
      id: { type: "google", lodgingId: name },
      name,
      location: { latitude: 0, longitude: 0 },
    },
    priceRate: {
      amount: 100,
      currencyCode: "USD",
      site: "Google",
      bookingUrl: "u",
    },
  };
}

describe("pollSearch", () => {
  it("returns immediately when isComplete:true on first call", async () => {
    let calls = 0;
    const result = await pollSearch({
      fetchPage: async () => {
        calls++;
        return {
          isComplete: true,
          offers: [makeOffer("A")],
        } as LodgingSearchResponse;
      },
      limit: 10,
      maxRetries: 3,
      sleep: async () => {},
    });
    expect(calls).toBe(1);
    expect(result.complete).toBe(true);
    expect(result.offers).toHaveLength(1);
  });

  it("stops early when offers.length >= limit even if incomplete", async () => {
    let calls = 0;
    const result = await pollSearch({
      fetchPage: async () => {
        calls++;
        return {
          isComplete: false,
          offers: [makeOffer("A"), makeOffer("B"), makeOffer("C")],
        } as LodgingSearchResponse;
      },
      limit: 2,
      maxRetries: 3,
      sleep: async () => {},
    });
    expect(calls).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.offers).toHaveLength(3);
  });

  it("polls up to maxRetries then returns complete:false", async () => {
    let calls = 0;
    const result = await pollSearch({
      fetchPage: async () => {
        calls++;
        return {
          isComplete: false,
          offers: [makeOffer("A")],
        } as LodgingSearchResponse;
      },
      limit: 10,
      maxRetries: 3,
      sleep: async () => {},
    });
    expect(calls).toBe(4); // initial + 3 retries
    expect(result.complete).toBe(false);
  });
});

function handlerCtx(overrides: Partial<AppContext["rest"]> = {}): AppContext {
  return {
    config: {} as never,
    rest: {
      geoAutocomplete: async () => [],
      getGeo: async () => ({ id: 80, name: "Pattaya", bounds: [1, 2, 3, 4] }),
      getTripWithResources: async () => ({
        tripPlan: {} as never,
        geos: [],
      }),
      searchLodgings: async () => ({ isComplete: true, offers: [] }),
      setCurrencyPreference: async () => {},
      ...overrides,
    },
  } as unknown as AppContext;
}

describe("searchHotels (handler)", () => {
  it("rejects when no destination mode is set", async () => {
    const res = await searchHotels(handlerCtx(), {
      check_in: "2026-06-01",
      check_out: "2026-06-03",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/exactly one of/i);
  });

  it("rejects when more than one mode is set", async () => {
    const res = await searchHotels(handlerCtx(), {
      destination: "Pattaya",
      geo_id: 80,
      check_in: "2026-06-01",
      check_out: "2026-06-03",
    });
    expect(res.isError).toBe(true);
  });

  it("rejects when check_out <= check_in", async () => {
    const res = await searchHotels(handlerCtx(), {
      destination: "Pattaya",
      check_in: "2026-06-03",
      check_out: "2026-06-01",
    });
    expect(res.isError).toBe(true);
  });

  it("returns JSON with offers, geo, and facets for a successful search", async () => {
    const offer: LodgingOffer = {
      lodging: {
        id: { type: "google", lodgingId: "x" },
        name: "Hotel Pattaya",
        rating: { source: "Google", value: 9 },
        ratingCount: 100,
        location: { latitude: 12.93, longitude: 100.91 },
        amenities: [{ name: "pool", category: null }],
        hotelClass: 4,
        lodgingType: "hotel",
      },
      priceRates: [
        { amount: 5000, currencyCode: "INR", site: "Google", bookingUrl: "g" },
        { amount: 5500, currencyCode: "INR", site: "Expedia", bookingUrl: "e" },
      ],
    };
    const ctx = handlerCtx({
      geoAutocomplete: async () => [
        {
          id: 80,
          name: "Pattaya",
          countryName: "Thailand",
          popularity: 90,
          latitude: 0,
          longitude: 0,
          bounds: [1, 2, 3, 4],
        },
      ],
      searchLodgings: async () => ({ isComplete: true, offers: [offer] }),
    });
    const res = await searchHotels(ctx, {
      destination: "Pattaya",
      check_in: "2026-06-01",
      check_out: "2026-06-03",
      limit: 5,
    });
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.geo.geo_id).toBe(80);
    expect(parsed.offers).toHaveLength(1);
    expect(parsed.offers[0].name).toBe("Hotel Pattaya");
    expect(parsed.total_results).toBe(1);
    expect(parsed.returned).toBe(1);
    expect(parsed.available_filters.amenities.pool).toBe(1);
    expect(parsed.complete).toBe(true);
    // No currency requested => response is labelled with the offers' own currency.
    expect(parsed.currency).toBe("INR");
  });

  it("slices to limit and reports total_results from the full set", async () => {
    const offers: LodgingOffer[] = Array.from({ length: 25 }, (_, i) => ({
      lodging: {
        id: { type: "google", lodgingId: String(i) },
        name: `Hotel ${i}`,
        location: { latitude: 0, longitude: 0 },
      },
      priceRate: {
        amount: 100 + i,
        currencyCode: "USD",
        site: "Google",
        bookingUrl: "u",
      },
    }));
    const ctx = handlerCtx({
      getGeo: async () => ({
        id: 80,
        name: "Pattaya",
        bounds: [1, 2, 3, 4] as [number, number, number, number],
      }),
      searchLodgings: async () => ({ isComplete: true, offers }),
    });
    const res = await searchHotels(ctx, {
      geo_id: 80,
      check_in: "2026-06-01",
      check_out: "2026-06-03",
      limit: 5,
    });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.total_results).toBe(25);
    expect(parsed.returned).toBe(5);
    expect(parsed.offers).toHaveLength(5);
  });

  it("sets the session currency before searching", async () => {
    const calls: string[] = [];
    const ctx = handlerCtx({
      getGeo: async () => ({
        id: 80,
        name: "Pattaya",
        bounds: [1, 2, 3, 4] as [number, number, number, number],
      }),
      setCurrencyPreference: async (c: string) => {
        calls.push(c);
      },
      searchLodgings: async () => ({ isComplete: true, offers: [] }),
    });
    await searchHotels(ctx, {
      geo_id: 80,
      check_in: "2026-06-01",
      check_out: "2026-06-03",
      currency: "ARS",
    });
    expect(calls).toEqual(["ARS"]);
  });

  it("does not mutate the shared session currency when no currency is passed", async () => {
    const calls: string[] = [];
    const ctx = handlerCtx({
      getGeo: async () => ({
        id: 80,
        name: "Pattaya",
        bounds: [1, 2, 3, 4] as [number, number, number, number],
      }),
      setCurrencyPreference: async (c: string) => {
        calls.push(c);
      },
    });
    const res = await searchHotels(ctx, {
      geo_id: 80,
      check_in: "2026-06-01",
      check_out: "2026-06-03",
    });
    // No explicit currency => never touch the global session preference.
    expect(calls).toEqual([]);
    const parsed = JSON.parse(res.content[0]!.text);
    // With no offers and no config default, the response label falls back to USD.
    expect(parsed.currency).toBe("USD");
  });

  it("labels the response from the offers' currency when none is requested", async () => {
    const calls: string[] = [];
    const ctx = handlerCtx({
      getGeo: async () => ({
        id: 80,
        name: "Pattaya",
        bounds: [1, 2, 3, 4] as [number, number, number, number],
      }),
      setCurrencyPreference: async (c: string) => {
        calls.push(c);
      },
      searchLodgings: async () => ({
        isComplete: true,
        offers: [
          {
            lodging: {
              id: { type: "google", lodgingId: "x" },
              name: "Hotel Pattaya",
              location: { latitude: 0, longitude: 0 },
            },
            priceRate: {
              amount: 5000,
              currencyCode: "THB",
              site: "Google",
              bookingUrl: "u",
            },
          },
        ],
      }),
    });
    const res = await searchHotels(ctx, {
      geo_id: 80,
      check_in: "2026-06-01",
      check_out: "2026-06-03",
    });
    expect(calls).toEqual([]);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.currency).toBe("THB");
  });

  it("response_format='detailed' surfaces amenities and metadata; 'concise' (default) omits them", async () => {
    const offer: LodgingOffer = {
      lodging: {
        id: { type: "google", lodgingId: "x" },
        name: "Hotel Pattaya",
        location: { latitude: 0, longitude: 0 },
        amenities: [
          { name: "pool", category: "outdoor" },
          { name: "wifi", category: null },
        ],
        hotelClass: 5,
        lodgingType: "hotel",
        accommodationType: "entire_place",
        images: [{ url: "u", thumbnailUrl: "thumb" }],
      },
      priceRate: {
        amount: 100,
        currencyCode: "USD",
        site: "Google",
        bookingUrl: "u",
      },
    };
    const ctx = handlerCtx({
      getGeo: async () => ({
        id: 80,
        name: "Pattaya",
        bounds: [1, 2, 3, 4] as [number, number, number, number],
      }),
      searchLodgings: async () => ({ isComplete: true, offers: [offer] }),
    });

    const detailed = await searchHotels(ctx, {
      geo_id: 80,
      check_in: "2026-06-01",
      check_out: "2026-06-03",
      response_format: "detailed",
    });
    const detailedJson = JSON.parse(detailed.content[0]!.text);
    expect(detailedJson.offers[0].amenities).toEqual(["pool", "wifi"]);
    expect(detailedJson.offers[0].hotel_class).toBe(5);
    expect(detailedJson.offers[0].lodging_type).toBe("hotel");
    expect(detailedJson.offers[0].accommodation_type).toBe("entire_place");
    expect(detailedJson.offers[0].thumbnail).toBe("thumb");

    const concise = await searchHotels(ctx, {
      geo_id: 80,
      check_in: "2026-06-01",
      check_out: "2026-06-03",
    });
    const conciseJson = JSON.parse(concise.content[0]!.text);
    expect(conciseJson.offers[0].amenities).toBeUndefined();
    expect(conciseJson.offers[0].hotel_class).toBeUndefined();
    expect(conciseJson.offers[0].lodging_type).toBeUndefined();
    expect(conciseJson.offers[0].accommodation_type).toBeUndefined();
    expect(conciseJson.offers[0].thumbnail).toBeUndefined();
    // Essentials still present:
    expect(conciseJson.offers[0].name).toBe("Hotel Pattaya");
    expect(conciseJson.offers[0].deals).toHaveLength(1);
  });
});
