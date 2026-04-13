import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context.js";
import {
  addChecklist,
  addChecklistDescription,
  addChecklistInputSchema,
} from "./tools/add-checklist.js";
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

const SERVER_INSTRUCTIONS = `
You are connected to Wanderdog, an MCP server for building Wanderlog trip itineraries.

When a user asks you to create an itinerary or plan a trip, build it in full — not just a list
of places. A complete itinerary uses all four building blocks on every day:

  1. wanderlog_add_place — 3-5 places per day (attractions, restaurants, activities)
  2. wanderlog_add_note — after EACH place, add a note with practical context: how to get
     there from the previous stop, what to order or see, whether advance booking is required,
     opening hours, and local tips. Every day should have notes between places.
  3. wanderlog_add_hotel — one hotel block covering the full stay
  4. wanderlog_add_checklist — at least one pre-trip checklist (visa, currency, offline maps,
     return ticket, travel insurance) and per-day checklists for days that need advance prep
     (timed-entry tickets, free-but-must-book venues, etc.)

IMPORTANT — interleave places and notes. For each day, follow this exact pattern:
  wanderlog_add_place (place 1)
  wanderlog_add_note (tips/transit for place 1)
  wanderlog_add_place (place 2)
  wanderlog_add_note (tips/transit for place 2)
  ... and so on.

Do NOT batch all places first and then add notes — that puts all notes at the bottom of the
day instead of between the places where they belong. The order matters because blocks appear
in the itinerary in the order they are added.

Places without notes are pins on a map. Notes are what make an itinerary actually useful.
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
    async (args) => listTrips(ctx, args as Parameters<typeof listTrips>[1]),
  );

  server.registerTool(
    "wanderlog_get_trip",
    {
      title: "Get a Wanderlog trip",
      description: getTripDescription,
      inputSchema: getTripInputSchema,
    },
    async (args) => getTrip(ctx, args as Parameters<typeof getTrip>[1]),
  );

  server.registerTool(
    "wanderlog_get_trip_url",
    {
      title: "Get the wanderlog.com URL for a trip",
      description: getTripUrlDescription,
      inputSchema: getTripUrlInputSchema,
    },
    async (args) => getTripUrl(ctx, args as Parameters<typeof getTripUrl>[1]),
  );

  server.registerTool(
    "wanderlog_search_places",
    {
      title: "Search places near a Wanderlog trip",
      description: searchPlacesDescription,
      inputSchema: searchPlacesInputSchema,
    },
    async (args) => searchPlaces(ctx, args as Parameters<typeof searchPlaces>[1]),
  );

  server.registerTool(
    "wanderlog_create_trip",
    {
      title: "Create a Wanderlog trip",
      description: createTripDescription,
      inputSchema: createTripInputSchema,
    },
    async (args) => createTrip(ctx, args as Parameters<typeof createTrip>[1]),
  );

  server.registerTool(
    "wanderlog_add_place",
    {
      title: "Add a place to a Wanderlog trip",
      description: addPlaceDescription,
      inputSchema: addPlaceInputSchema,
    },
    async (args) => addPlace(ctx, args as Parameters<typeof addPlace>[1]),
  );

  server.registerTool(
    "wanderlog_add_hotel",
    {
      title: "Add a hotel booking to a Wanderlog trip",
      description: addHotelDescription,
      inputSchema: addHotelInputSchema,
    },
    async (args) => addHotel(ctx, args as Parameters<typeof addHotel>[1]),
  );

  server.registerTool(
    "wanderlog_add_note",
    {
      title: "Add a note to a Wanderlog trip",
      description: addNoteDescription,
      inputSchema: addNoteInputSchema,
    },
    async (args) => addNote(ctx, args as Parameters<typeof addNote>[1]),
  );

  server.registerTool(
    "wanderlog_add_checklist",
    {
      title: "Add a checklist to a Wanderlog trip",
      description: addChecklistDescription,
      inputSchema: addChecklistInputSchema,
    },
    async (args) => addChecklist(ctx, args as Parameters<typeof addChecklist>[1]),
  );

  server.registerTool(
    "wanderlog_remove_place",
    {
      title: "Remove a place from a Wanderlog trip",
      description: removePlaceDescription,
      inputSchema: removePlaceInputSchema,
    },
    async (args) => removePlace(ctx, args as Parameters<typeof removePlace>[1]),
  );

  server.registerTool(
    "wanderlog_update_trip_dates",
    {
      title: "Update a Wanderlog trip's date range",
      description: updateTripDatesDescription,
      inputSchema: updateTripDatesInputSchema,
    },
    async (args) =>
      updateTripDates(ctx, args as Parameters<typeof updateTripDates>[1]),
  );

  return server;
}
