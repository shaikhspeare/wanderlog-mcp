import type { PlaceBlock, Section, TripPlan } from "../../src/types.ts";

/**
 * Synthetic large-trip fixture approximating the real Japan trip used as
 * the Phase 3 token-budget benchmark: ~134 places across ~14 days with
 * a mix of notes, hotels, flights, and day sections.
 *
 * Used by tests/unit/token-budgets.test.ts to assert the formatter's
 * concise and detailed outputs stay under budget for realistic trip sizes.
 */
export function buildLargeTrip(placeCount = 134, dayCount = 14): TripPlan {
  const startDate = "2025-11-01";
  const endDate = addDays(startDate, dayCount - 1);

  const sections: Section[] = [];

  sections.push({
    id: 100,
    type: "textOnly",
    mode: "placeList",
    heading: "Notes",
    date: null,
    blocks: [],
  });

  sections.push({
    id: 101,
    type: "flights",
    mode: "placeList",
    heading: "Flights",
    date: null,
    blocks: [
      {
        id: 900,
        type: "flight",
        flightInfo: {
          airline: { iata: "NH", name: "All Nippon Airways" },
          number: 890,
        },
        depart: {
          date: startDate,
          time: "19:50",
          airport: { iata: "SYD", name: "Sydney Airport", cityName: "Sydney" },
        },
        arrive: {
          date: addDays(startDate, 1),
          time: "05:00",
          airport: { iata: "HND", name: "Haneda Airport", cityName: "Tokyo" },
        },
        confirmationNumber: "ABC123",
      },
    ],
  });

  sections.push({
    id: 102,
    type: "hotels",
    mode: "placeList",
    heading: "Hotels and lodging",
    date: null,
    blocks: [
      makePlaceBlock(500, "Hotel Tokyo", {
        formatted_address: "1-2-3 Asakusa, Taito City, Tokyo",
        rating: 4.4,
        user_ratings_total: 512,
        types: ["hotel", "lodging"],
        international_phone_number: "+81 3 0000 0000",
      }),
      makePlaceBlock(501, "Hotel Kyoto", {
        formatted_address: "4-5-6 Gion, Higashiyama Ward, Kyoto",
        rating: 4.6,
        user_ratings_total: 890,
        types: ["hotel", "lodging"],
      }),
    ],
  });

  // "Places to visit" section
  const placesToVisit: PlaceBlock[] = [];
  sections.push({
    id: 103,
    type: "normal",
    mode: "placeList",
    heading: "Places to visit",
    date: null,
    blocks: placesToVisit,
  });

  const placesPerDay = Math.floor(placeCount / dayCount);
  const leftover = placeCount - placesPerDay * dayCount;

  let blockId = 1000;
  for (let d = 0; d < dayCount; d++) {
    const date = addDays(startDate, d);
    const nOnDay = placesPerDay + (d < leftover ? 1 : 0);
    const blocks: PlaceBlock[] = [];
    for (let i = 0; i < nOnDay; i++) {
      blocks.push(
        makePlaceBlock(blockId++, `Place ${blockId} in District ${d + 1}`, {
          formatted_address: `${100 + i} Main Street, District ${d + 1}, City`,
          rating: 4.2 + (i % 8) * 0.1,
          user_ratings_total: 100 + i * 7,
          types: ["tourist_attraction", "point_of_interest"],
        }),
      );
    }
    sections.push({
      id: 200 + d,
      type: "normal",
      mode: "dayPlan",
      heading: "",
      date,
      blocks,
    });
  }

  return {
    id: 77777777,
    key: "largetripkey1234",
    title: "Trip to Japan",
    userId: 1,
    privacy: "private",
    startDate,
    endDate,
    days: dayCount,
    placeCount,
    schemaVersion: 2,
    createdAt: "2025-10-01T00:00:00Z",
    updatedAt: "2025-11-01T00:00:00Z",
    contributors: [{ id: 1, username: "tester" }],
    itinerary: { sections },
  };
}

function makePlaceBlock(
  id: number,
  name: string,
  extras: {
    formatted_address?: string;
    rating?: number;
    user_ratings_total?: number;
    types?: string[];
    international_phone_number?: string;
  },
): PlaceBlock {
  return {
    id,
    type: "place",
    place: {
      name,
      place_id: `ChIJsynthetic${id}`,
      geometry: { location: { lat: 35.68 + id * 0.001, lng: 139.69 + id * 0.001 } },
      ...extras,
    },
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
