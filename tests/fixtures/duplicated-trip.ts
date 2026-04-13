import type { TripPlan } from "../../src/types.ts";

/**
 * Fixture reproducing the exact bug-report state: a trip with duplicate
 * place entries on multiple days (mirrors the post-conflict Queenstown trip).
 * Used to verify the resolver can disambiguate duplicates via ordinals.
 */
export const duplicatedTrip: TripPlan = {
  id: 77777777,
  key: "duplicatedtestkey",
  title: "Trip to Queenstown",
  userId: 3656632,
  privacy: "friends",
  startDate: "2026-05-03",
  endDate: "2026-05-08",
  days: 6,
  placeCount: 10,
  schemaVersion: 2,
  createdAt: "2026-04-11T00:00:00Z",
  updatedAt: "2026-04-11T00:00:00Z",
  itinerary: {
    sections: [
      {
        id: 1,
        type: "textOnly",
        mode: "placeList",
        heading: "Notes",
        date: null,
        blocks: [],
      },
      {
        id: 2,
        type: "normal",
        mode: "placeList",
        heading: "Places to visit",
        date: null,
        blocks: [
          {
            id: 101,
            type: "place",
            place: {
              name: "Queenstown Gardens",
              place_id: "ChIJqg1",
              geometry: { location: { lat: -45.03, lng: 168.66 } },
            },
          },
        ],
      },
      {
        id: 3,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2026-05-04",
        blocks: [
          {
            id: 201,
            type: "place",
            place: {
              name: "Queenstown Gardens",
              place_id: "ChIJqg2",
              geometry: { location: { lat: -45.03, lng: 168.66 } },
            },
          },
          {
            id: 202,
            type: "place",
            place: {
              name: "Queenstown Gardens",
              place_id: "ChIJqg3",
              geometry: { location: { lat: -45.03, lng: 168.66 } },
            },
          },
        ],
      },
      {
        id: 4,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2026-05-05",
        blocks: [
          {
            id: 301,
            type: "place",
            place: {
              name: "RealNZ | Walter Peak High Country Farm",
              place_id: "ChIJwp1",
              geometry: { location: { lat: -45.05, lng: 168.6 } },
            },
          },
          {
            id: 302,
            type: "place",
            place: {
              name: "RealNZ | Walter Peak High Country Farm",
              place_id: "ChIJwp2",
              geometry: { location: { lat: -45.05, lng: 168.6 } },
            },
          },
        ],
      },
      {
        id: 5,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2026-05-06",
        blocks: [],
      },
      {
        id: 6,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2026-05-07",
        blocks: [
          {
            id: 501,
            type: "place",
            place: {
              name: "Lake Hayes Estate",
              place_id: "ChIJlh1",
              geometry: { location: { lat: -44.97, lng: 168.8 } },
            },
          },
          {
            id: 502,
            type: "place",
            place: {
              name: "Lake Hayes Estate",
              place_id: "ChIJlh2",
              geometry: { location: { lat: -44.97, lng: 168.8 } },
            },
          },
        ],
      },
    ],
  },
};
