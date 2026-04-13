import type { AppContext } from "../src/context.js";
import { addHotel, addHotelDescription, addHotelInputSchema } from "../src/tools/add-hotel.js";
import { addPlace, addPlaceDescription, addPlaceInputSchema } from "../src/tools/add-place.js";
import {
  createTrip,
  createTripDescription,
  createTripInputSchema,
} from "../src/tools/create-trip.js";
import { getTrip, getTripDescription, getTripInputSchema } from "../src/tools/get-trip.js";
import {
  getTripUrl,
  getTripUrlDescription,
  getTripUrlInputSchema,
} from "../src/tools/get-trip-url.js";
import {
  listTrips,
  listTripsDescription,
  listTripsInputSchema,
} from "../src/tools/list-trips.js";
import {
  removePlace,
  removePlaceDescription,
  removePlaceInputSchema,
} from "../src/tools/remove-place.js";
import {
  searchPlaces,
  searchPlacesDescription,
  searchPlacesInputSchema,
} from "../src/tools/search-places.js";
import {
  updateTripDates,
  updateTripDatesDescription,
  updateTripDatesInputSchema,
} from "../src/tools/update-trip-dates.js";
import { zodShapeToInputSchema, type AnthropicToolInputSchema } from "./schema.js";

export type WanderdogToolDef = {
  name: string;
  description: string;
  input_schema: AnthropicToolInputSchema;
  /** Direct in-process dispatcher. Returns the tool's text result. */
  run: (
    ctx: AppContext,
    input: Record<string, unknown>,
  ) => Promise<{ text: string; isError: boolean }>;
};

type MinimalToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function wrap<Args>(
  fn: (ctx: AppContext, args: Args) => Promise<MinimalToolResult>,
): WanderdogToolDef["run"] {
  return async (ctx, input) => {
    const result = await fn(ctx, input as Args);
    const text = result.content.map((c) => c.text).join("\n");
    return { text, isError: result.isError === true };
  };
}

/**
 * The full set of Wanderdog tools exposed to the agent under evaluation.
 * This list is the source of truth for both evals and (in spirit) the MCP
 * server wiring — any new tool should land in both places.
 */
export const WANDERDOG_TOOLS: WanderdogToolDef[] = [
  {
    name: "wanderlog_list_trips",
    description: listTripsDescription,
    input_schema: zodShapeToInputSchema(listTripsInputSchema),
    run: wrap(listTrips),
  },
  {
    name: "wanderlog_get_trip",
    description: getTripDescription,
    input_schema: zodShapeToInputSchema(getTripInputSchema),
    run: wrap(getTrip),
  },
  {
    name: "wanderlog_get_trip_url",
    description: getTripUrlDescription,
    input_schema: zodShapeToInputSchema(getTripUrlInputSchema),
    run: wrap(getTripUrl),
  },
  {
    name: "wanderlog_search_places",
    description: searchPlacesDescription,
    input_schema: zodShapeToInputSchema(searchPlacesInputSchema),
    run: wrap(searchPlaces),
  },
  {
    name: "wanderlog_create_trip",
    description: createTripDescription,
    input_schema: zodShapeToInputSchema(createTripInputSchema),
    run: wrap(createTrip),
  },
  {
    name: "wanderlog_add_place",
    description: addPlaceDescription,
    input_schema: zodShapeToInputSchema(addPlaceInputSchema),
    run: wrap(addPlace),
  },
  {
    name: "wanderlog_add_hotel",
    description: addHotelDescription,
    input_schema: zodShapeToInputSchema(addHotelInputSchema),
    run: wrap(addHotel),
  },
  {
    name: "wanderlog_remove_place",
    description: removePlaceDescription,
    input_schema: zodShapeToInputSchema(removePlaceInputSchema),
    run: wrap(removePlace),
  },
  {
    name: "wanderlog_update_trip_dates",
    description: updateTripDatesDescription,
    input_schema: zodShapeToInputSchema(updateTripDatesInputSchema),
    run: wrap(updateTripDates),
  },
];

export const TOOLS_BY_NAME: Record<string, WanderdogToolDef> =
  Object.fromEntries(WANDERDOG_TOOLS.map((t) => [t.name, t]));

export function readOnlyTools(): WanderdogToolDef[] {
  const readOnlyNames = new Set([
    "wanderlog_list_trips",
    "wanderlog_get_trip",
    "wanderlog_get_trip_url",
    "wanderlog_search_places",
  ]);
  return WANDERDOG_TOOLS.filter((t) => readOnlyNames.has(t.name));
}
