import { describe, expect, it } from "vitest";
import { buildSearchBody, projectOffer } from "../../src/tools/search-hotels.ts";
import type { LodgingOffer } from "../../src/types.ts";

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
