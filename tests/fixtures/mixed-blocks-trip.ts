import type { TripPlan } from "../../src/types.ts";

/**
 * Fixture mirroring the shape of a real complex trip (the Japan trip that
 * exposed the block-type bug). Contains flight, train, note, and place
 * blocks so the formatter is exercised against every block type at once.
 */
export const mixedBlocksTrip: TripPlan = {
  id: 99999999,
  key: "hxziqupjjlmrfrxw",
  title: "Trip to Japan",
  userId: 3656632,
  privacy: "friends",
  startDate: "2025-11-13",
  endDate: "2025-11-15",
  days: 3,
  placeCount: 5,
  schemaVersion: 2,
  createdAt: "2025-10-01T00:00:00Z",
  updatedAt: "2025-11-01T00:00:00Z",
  contributors: [{ id: 3656632, username: "ali1253" }],
  itinerary: {
    sections: [
      {
        id: 111,
        type: "textOnly",
        mode: "placeList",
        heading: "Notes",
        date: null,
        blocks: [],
      },
      {
        id: 222,
        type: "flights",
        mode: "placeList",
        heading: "Flights",
        date: null,
        blocks: [
          {
            id: 893453814,
            type: "flight",
            flightInfo: {
              airline: { iata: "NH", name: "ANA (All Nippon Airways)" },
              number: 890,
            },
            depart: {
              date: "2025-11-13",
              time: "19:50",
              airport: { iata: "SYD", name: "Sydney Airport", cityName: "Sydney" },
            },
            arrive: {
              date: "2025-11-14",
              time: "05:00",
              airport: { iata: "HND", name: "Haneda Airport", cityName: "Tokyo" },
            },
            confirmationNumber: "ABC123",
            travelerNames: ["Ali Shayk"],
          },
        ],
      },
      {
        id: 333,
        type: "transit",
        mode: "placeList",
        heading: "Transit",
        date: null,
        blocks: [
          {
            id: 308894299,
            type: "train",
            carrier: "Odakyu Electric Railway",
            depart: {
              date: "2025-11-18",
              time: "10:00",
              place: { name: "Shinjuku Station" },
            },
            arrive: {
              date: "2025-11-18",
              time: "11:30",
              place: { name: "Odawara Station" },
            },
          },
        ],
      },
      {
        id: 444,
        type: "hotels",
        mode: "placeList",
        heading: "Hotels and lodging",
        date: null,
        blocks: [
          {
            id: 888,
            type: "place",
            place: {
              name: "Far East Village Hotel Tokyo, Asakusa",
              place_id: "ChIJxxxxxxx",
              geometry: { location: { lat: 35.71, lng: 139.8 } },
              rating: 4.4,
              user_ratings_total: 500,
              types: ["hotel"],
            },
            hotel: {
              checkIn: "2025-11-14",
              checkOut: "2025-11-16",
              travelerNames: ["Ali"],
              confirmationNumber: "HOTEL123",
            },
          },
        ],
      },
      {
        id: 555,
        type: "normal",
        mode: "dayPlan",
        heading: "Tokyo - Arrival",
        date: "2025-11-13",
        blocks: [
          {
            id: 10001,
            type: "place",
            place: {
              name: "Sensō-ji",
              place_id: "ChIJyyyyyyy",
              geometry: { location: { lat: 35.7148, lng: 139.7967 } },
              rating: 4.5,
              types: ["tourist_attraction", "place_of_worship"],
            },
            startTime: "14:00",
            endTime: "16:00",
          },
          {
            id: 10002,
            type: "note",
            text: {
              ops: [
                { insert: "Check out the ", attributes: {} },
                {
                  insert: "Nakamise shopping street",
                  attributes: { link: "https://example.com/nakamise" },
                },
                { insert: " before heading to the temple.\n" },
              ],
            },
          },
        ],
      },
      {
        id: 666,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2025-11-14",
        blocks: [],
      },
      {
        id: 777,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2025-11-15",
        blocks: [
          {
            id: 20001,
            type: "malformed-unknown-type",
          } as unknown as TripPlan["itinerary"]["sections"][0]["blocks"][0],
        ],
      },
    ],
  },
};
