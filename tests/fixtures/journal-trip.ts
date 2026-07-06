import type { TripPlan } from "../../src/types.ts";

/**
 * Fixture with a populated `itinerary.journal` for testing the list / add /
 * edit / remove journal tools. Stops carry the real Wanderlog shape (embedded
 * place, QuillDelta text, media, timezone-aware dateTime). Two "Ganso" stops
 * exercise the ambiguity path; their dates differ so a date filter can pick one.
 */
export const journalTrip: TripPlan = {
  id: 99999999,
  key: "journaltripkey",
  title: "Trip to Fukuoka",
  userId: 3656632,
  privacy: "private",
  startDate: "2026-05-29",
  endDate: "2026-05-31",
  days: 3,
  placeCount: 0,
  schemaVersion: 2,
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-15T00:00:00Z",
  itinerary: {
    sections: [
      {
        id: 100,
        type: "normal",
        mode: "placeList",
        heading: "Places to visit",
        date: null,
        blocks: [
          {
            id: 40001,
            type: "place",
            place: { name: "Ōhori Park", place_id: "ChIJohori" },
          },
        ],
      },
      {
        id: 200,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2026-05-29",
        blocks: [
          {
            id: 40002,
            type: "place",
            place: { name: "Tōchō-ji Temple", place_id: "ChIJtochoji" },
          },
        ],
      },
    ],
    journal: {
      summary: "Three days of food in Fukuoka.",
      stops: [
        {
          id: 571059554,
          type: "confirmed",
          title: "Ganso Hakata Mentaiju",
          dateTime: "2026-05-29T09:00+09:00",
          place: { name: "Ganso Hakata Mentaiju", place_id: "ChIJmentaiju" },
          text: { ops: [{ insert: "Best mentaiko rice in the city." }] },
          media: [],
        },
        {
          id: 571059555,
          type: "confirmed",
          title: "Fushimi Inari Taisha",
          dateTime: "2026-05-30T09:00+09:00",
          place: { name: "Fushimi Inari Taisha", place_id: "ChIJfushimi" },
          text: { ops: [{ insert: "Hiked the torii gates at dawn." }] },
          media: [
            { type: "uploaded", key: "abc123", width: 270, height: 148, mediaType: "image" },
          ],
        },
        {
          id: 571059556,
          type: "confirmed",
          title: "Ganso Hakata Mentaiju",
          dateTime: "2026-05-31T12:00+09:00",
          place: { name: "Ganso Hakata Mentaiju", place_id: "ChIJmentaiju" },
          media: [],
        },
      ],
    },
  },
};
