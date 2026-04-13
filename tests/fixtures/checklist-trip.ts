import type { TripPlan } from "../../src/types.ts";

/**
 * Fixture with note and checklist blocks for testing the formatter,
 * apply-op with rich-text subtype, and the add-note / add-checklist builders.
 */
export const checklistTrip: TripPlan = {
  id: 77777777,
  key: "checklisttripkey",
  title: "Trip to Barcelona",
  userId: 3656632,
  privacy: "private",
  startDate: "2026-06-01",
  endDate: "2026-06-04",
  days: 4,
  placeCount: 2,
  schemaVersion: 2,
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-15T00:00:00Z",
  itinerary: {
    sections: [
      {
        id: 100,
        type: "textOnly",
        mode: "placeList",
        heading: "Notes",
        date: null,
        blocks: [],
      },
      {
        id: 200,
        type: "normal",
        mode: "placeList",
        heading: "Places to visit",
        date: null,
        blocks: [
          {
            id: 50001,
            type: "place",
            place: {
              name: "La Sagrada Familia",
              place_id: "ChIJsagrada",
              geometry: { location: { lat: 41.4036, lng: 2.1744 } },
              rating: 4.8,
            },
          },
        ],
      },
      {
        id: 300,
        type: "normal",
        mode: "dayPlan",
        heading: "Arrival day",
        date: "2026-06-01",
        blocks: [
          {
            id: 60001,
            type: "place",
            place: {
              name: "Park Güell",
              place_id: "ChIJguell",
              geometry: { location: { lat: 41.4145, lng: 2.1527 } },
            },
          },
          {
            id: 60002,
            type: "note",
            text: {
              ops: [{ insert: "Don't forget the sunscreen!\n" }],
            },
            addedBy: { type: "user", userId: 3656632 },
            attachments: [],
          },
          {
            id: 60003,
            type: "checklist",
            items: [
              {
                id: 70001,
                checked: true,
                text: { ops: [{ insert: "Book tickets online\n" }] },
              },
              {
                id: 70002,
                checked: false,
                text: { ops: [{ insert: "Pack comfortable shoes\n" }] },
              },
              {
                id: 70003,
                checked: false,
                text: { ops: [{ insert: "Download offline map\n" }] },
              },
            ],
            title: "Packing list",
            addedBy: { type: "user", userId: 3656632 },
            attachments: [],
          },
        ],
      },
      {
        id: 400,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2026-06-02",
        blocks: [],
      },
      {
        id: 500,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2026-06-03",
        blocks: [
          {
            id: 60004,
            type: "checklist",
            items: [],
            title: "",
            addedBy: { type: "user", userId: 3656632 },
            attachments: [],
          },
        ],
      },
      {
        id: 600,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2026-06-04",
        blocks: [],
      },
    ],
  },
};
