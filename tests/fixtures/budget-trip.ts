import type { TripPlan } from "../../src/types.ts";

/**
 * Fixture with a populated `itinerary.budget.expenses` array for testing the
 * list / remove / edit expense tools. Expenses carry the full Wanderlog shape
 * (nested `amount`, plus paidByUser / splitWith / blockId) so tests can assert
 * that edits preserve unknown fields. Two "Ichiran" expenses exercise the
 * ambiguity path; date / amount / currency differ so filters can disambiguate.
 */
export const budgetTrip: TripPlan = {
  id: 88888888,
  key: "budgettripkey",
  title: "Trip to Tokyo",
  userId: 3656632,
  privacy: "private",
  startDate: "2026-06-01",
  endDate: "2026-06-03",
  days: 3,
  placeCount: 1,
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
            id: 50001,
            type: "place",
            place: { name: "Sensō-ji", place_id: "ChIJsensoji" },
          },
        ],
      },
    ],
    budget: {
      currencyCode: "USD",
      expenses: [
        {
          id: 90001,
          amount: { amount: 12.5, currencyCode: "USD" },
          category: "food",
          description: "Lunch at Ichiran Ramen",
          date: "2026-06-01",
          paidByUserId: 3656632,
          paidByUser: { type: "registered", id: 3656632 },
          splitWith: { type: "individuals", users: [] },
          blockId: 50001,
          associatedDate: "2026-06-01",
        },
        {
          id: 90002,
          amount: { amount: 8, currencyCode: "USD" },
          category: "publicTransit",
          description: "Subway day pass",
          date: "2026-06-01",
          paidByUserId: 3656632,
          blockId: 50001,
          associatedDate: "2026-06-01",
        },
        {
          id: 90003,
          amount: { amount: 2000, currencyCode: "JPY" },
          category: "food",
          description: "Dinner at Ichiran Ramen",
          date: "2026-06-02",
          paidByUserId: 3656632,
          blockId: 50001,
          associatedDate: "2026-06-02",
        },
        {
          id: 90004,
          amount: { amount: 15, currencyCode: "EUR" },
          category: "sightseeing",
          description: "Museum entry",
          date: "2026-06-03",
          paidByUserId: 3656632,
          blockId: 50001,
          associatedDate: "2026-06-03",
        },
      ],
    },
  },
};
