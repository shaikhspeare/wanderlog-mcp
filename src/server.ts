import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context.js";
import {
  addChecklist,
  addChecklistDescription,
  addChecklistInputSchema,
} from "./tools/add-checklist.js";
import {
  addExpense,
  addExpenseDescription,
  addExpenseInputSchema,
} from "./tools/add-expense.js";
import {
  annotatePlace,
  annotatePlaceDescription,
  annotatePlaceInputSchema,
} from "./tools/annotate-place.js";
import {
  addHotel,
  addHotelDescription,
  addHotelInputSchema,
} from "./tools/add-hotel.js";
import {
  addNote,
  addNoteDescription,
  addNoteInputSchema,
} from "./tools/add-note.js";
import {
  addPlace,
  addPlaceDescription,
  addPlaceInputSchema,
} from "./tools/add-place.js";
import {
  createTrip,
  createTripDescription,
  createTripInputSchema,
} from "./tools/create-trip.js";
import {
  getTrip,
  getTripDescription,
  getTripInputSchema,
} from "./tools/get-trip.js";
import {
  getTripUrl,
  getTripUrlDescription,
  getTripUrlInputSchema,
} from "./tools/get-trip-url.js";
import {
  listTrips,
  listTripsDescription,
  listTripsInputSchema,
} from "./tools/list-trips.js";
import {
  removePlace,
  removePlaceDescription,
  removePlaceInputSchema,
} from "./tools/remove-place.js";
import {
  searchPlaces,
  searchPlacesDescription,
  searchPlacesInputSchema,
} from "./tools/search-places.js";
import {
  updateTripDates,
  updateTripDatesDescription,
  updateTripDatesInputSchema,
} from "./tools/update-trip-dates.js";

const AUTH_ERROR_RESPONSE = {
  content: [
    {
      type: "text" as const,
      text: "Authentication required. Update WANDERLOG_COOKIE with a valid connect.sid cookie from wanderlog.com and restart the server.",
    },
  ],
  isError: true,
};

function requireAuth(
  ctx: AppContext,
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>,
) {
  return async (args: Record<string, unknown>) => {
    if (!ctx.authenticated) return AUTH_ERROR_RESPONSE;
    return handler(args);
  };
}

const SERVER_INSTRUCTIONS = `
You are connected to Wanderdog, an MCP server for building Wanderlog trip itineraries.

When a user asks you to create an itinerary or plan a trip, build it in full — not just a list
of places. A complete itinerary uses these building blocks:

  1. wanderlog_add_place — 3-5 places per day (attractions, restaurants, activities).
     ALWAYS use the "note" parameter to attach practical context directly to the place: how to
     get there, what to order, booking tips, opening hours. ALWAYS use "start_time" and
     "end_time" to schedule each place (e.g. start_time: "09:00", end_time: "10:30").
     This is one tool call instead of two — faster and the note lives on the place itself.
  2. wanderlog_add_note — use ONLY for freestanding commentary between places: neighborhood
     context, multi-stop transit directions, or day-level tips not about a specific place.
     Do NOT use add_note for per-place context — use the "note" param on add_place instead.
  3. wanderlog_add_hotel — one hotel block covering the full stay
  4. wanderlog_add_checklist — at least one pre-trip checklist (visa, currency, offline maps,
     return ticket, travel insurance) and per-day checklists for days that need advance prep
  5. wanderlog_add_expense — add estimated costs for meals, entrance fees, transport passes.
     Link each expense to its place for budget tracking.
  6. wanderlog_annotate_place — update an existing place with a note, start/end time, or both.

Example add_place call with all features:
  wanderlog_add_place(trip_key, place: "Sensō-ji", day: "day 1",
    note: "Arrive before 9am to avoid crowds. Free entry. The Nakamise shopping street
    leading to the temple is great for souvenirs and snacks.",
    start_time: "08:30", end_time: "10:00")

Places without notes and times are just pins on a map. Rich places make an itinerary useful.
`.trim();

export function buildServer(ctx: AppContext): McpServer {
  const server = new McpServer(
    { name: "wanderdog", version: "0.0.2" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "wanderlog_list_trips",
    {
      title: "List Wanderlog trips",
      description: listTripsDescription,
      inputSchema: listTripsInputSchema,
    },
    requireAuth(ctx, async (args) => listTrips(ctx, args as Parameters<typeof listTrips>[1])),
  );

  server.registerTool(
    "wanderlog_get_trip",
    {
      title: "Get a Wanderlog trip",
      description: getTripDescription,
      inputSchema: getTripInputSchema,
    },
    requireAuth(ctx, async (args) => getTrip(ctx, args as Parameters<typeof getTrip>[1])),
  );

  server.registerTool(
    "wanderlog_get_trip_url",
    {
      title: "Get the wanderlog.com URL for a trip",
      description: getTripUrlDescription,
      inputSchema: getTripUrlInputSchema,
    },
    requireAuth(ctx, async (args) => getTripUrl(ctx, args as Parameters<typeof getTripUrl>[1])),
  );

  server.registerTool(
    "wanderlog_search_places",
    {
      title: "Search places near a Wanderlog trip",
      description: searchPlacesDescription,
      inputSchema: searchPlacesInputSchema,
    },
    requireAuth(ctx, async (args) => searchPlaces(ctx, args as Parameters<typeof searchPlaces>[1])),
  );

  server.registerTool(
    "wanderlog_create_trip",
    {
      title: "Create a Wanderlog trip",
      description: createTripDescription,
      inputSchema: createTripInputSchema,
    },
    requireAuth(ctx, async (args) => createTrip(ctx, args as Parameters<typeof createTrip>[1])),
  );

  server.registerTool(
    "wanderlog_add_place",
    {
      title: "Add a place to a Wanderlog trip",
      description: addPlaceDescription,
      inputSchema: addPlaceInputSchema,
    },
    requireAuth(ctx, async (args) => addPlace(ctx, args as Parameters<typeof addPlace>[1])),
  );

  server.registerTool(
    "wanderlog_add_hotel",
    {
      title: "Add a hotel booking to a Wanderlog trip",
      description: addHotelDescription,
      inputSchema: addHotelInputSchema,
    },
    requireAuth(ctx, async (args) => addHotel(ctx, args as Parameters<typeof addHotel>[1])),
  );

  server.registerTool(
    "wanderlog_add_note",
    {
      title: "Add a note to a Wanderlog trip",
      description: addNoteDescription,
      inputSchema: addNoteInputSchema,
    },
    requireAuth(ctx, async (args) => addNote(ctx, args as Parameters<typeof addNote>[1])),
  );

  server.registerTool(
    "wanderlog_add_checklist",
    {
      title: "Add a checklist to a Wanderlog trip",
      description: addChecklistDescription,
      inputSchema: addChecklistInputSchema,
    },
    requireAuth(ctx, async (args) => addChecklist(ctx, args as Parameters<typeof addChecklist>[1])),
  );

  server.registerTool(
    "wanderlog_annotate_place",
    {
      title: "Update a place with notes, times, or both",
      description: annotatePlaceDescription,
      inputSchema: annotatePlaceInputSchema,
    },
    requireAuth(ctx, async (args) =>
      annotatePlace(ctx, args as Parameters<typeof annotatePlace>[1])),
  );

  server.registerTool(
    "wanderlog_add_expense",
    {
      title: "Add a budget expense to a Wanderlog trip",
      description: addExpenseDescription,
      inputSchema: addExpenseInputSchema,
    },
    requireAuth(ctx, async (args) =>
      addExpense(ctx, args as Parameters<typeof addExpense>[1])),
  );

  server.registerTool(
    "wanderlog_remove_place",
    {
      title: "Remove a place from a Wanderlog trip",
      description: removePlaceDescription,
      inputSchema: removePlaceInputSchema,
    },
    requireAuth(ctx, async (args) => removePlace(ctx, args as Parameters<typeof removePlace>[1])),
  );

  server.registerTool(
    "wanderlog_update_trip_dates",
    {
      title: "Update a Wanderlog trip's date range",
      description: updateTripDatesDescription,
      inputSchema: updateTripDatesInputSchema,
    },
    requireAuth(ctx, async (args) =>
      updateTripDates(ctx, args as Parameters<typeof updateTripDates>[1])),
  );

  return server;
}
