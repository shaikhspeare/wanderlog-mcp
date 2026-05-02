import type { TripPlan } from "../../src/types.ts";

/**
 * Fixture with multiple notes across days and the placeList section. Used to
 * exercise the note-ref resolver's substring / ordinal / day-filter logic.
 *
 * Notes layout:
 *   - Places-to-visit ("Notes" section): one "pre-trip checklist reminder" note
 *   - Day 2026-05-06: two notes — "coach tour departure" and "coach tour return"
 *   - Day 2026-05-07: one "anniversary dinner" note
 */
export const notesTrip: TripPlan = {
  id: 99999999,
  key: "notestriptestkey",
  editKey: "notestriptestkey",
  viewKey: "vvvvvvvvv",
  suggestKey: "ssssssssss",
  title: "Notes Fixture Trip",
  userId: 3656632,
  privacy: "private",
  startDate: "2026-05-06",
  endDate: "2026-05-07",
  days: 2,
  placeCount: 0,
  schemaVersion: 2,
  createdAt: "2026-04-20T00:00:00Z",
  updatedAt: "2026-04-20T00:00:00Z",
  contributors: [{ id: 3656632, username: "ali", name: "Ali" }],
  editors: [{ id: 3656632, username: "ali", name: "Ali" }],
  itinerary: {
    sections: [
      {
        id: 1,
        type: "textOnly",
        mode: "placeList",
        heading: "Notes",
        date: null,
        blocks: [
          {
            id: 5001,
            type: "note",
            text: { ops: [{ insert: "Pre-trip checklist reminder: pack warm layers\n" }] },
            addedBy: { type: "user", userId: 3656632 },
            attachments: [],
          },
        ],
      },
      {
        id: 2,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2026-05-06",
        blocks: [
          {
            id: 5002,
            type: "note",
            text: { ops: [{ insert: "Coach tour departure — 07:00 from Queenstown\n" }] },
            addedBy: { type: "user", userId: 3656632 },
            attachments: [],
          },
          {
            id: 5003,
            type: "note",
            text: { ops: [{ insert: "Coach tour return — back by 19:30\n" }] },
            addedBy: { type: "user", userId: 3656632 },
            attachments: [],
          },
        ],
      },
      {
        id: 3,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2026-05-07",
        blocks: [
          {
            id: 5004,
            type: "note",
            text: { ops: [{ insert: "Anniversary dinner — book 2 weeks ahead\n" }] },
            addedBy: { type: "user", userId: 3656632 },
            attachments: [],
          },
        ],
      },
    ],
  },
};
