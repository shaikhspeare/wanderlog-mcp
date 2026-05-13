import { describe, expect, it } from "vitest";
import { buildSearchBody } from "../../src/tools/search-hotels.ts";

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
