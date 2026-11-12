import { loadConfig } from "../../src/config.ts";
import { RestClient } from "../../src/transport/rest.ts";

/**
 * The trip the read-only integration tests inspect. Uses WANDERLOG_TRIP_KEY when set
 * (blank counts as unset, matching the empty placeholder in .env.example); otherwise
 * picks a trip with places from the authenticated account, so the suite works for any
 * contributor without extra setup. Throwaway WANDERDOG_* trips from other tests are
 * skipped because they may be deleted mid-run.
 */
export async function resolveTestTripKey(): Promise<string> {
  const fromEnv = process.env.WANDERLOG_TRIP_KEY?.trim();
  if (fromEnv) return fromEnv;

  const trips = await new RestClient(loadConfig()).listTrips();
  const candidates = trips.filter((trip) => !trip.title.startsWith("WANDERDOG_"));
  const pick = candidates.find((trip) => trip.placeCount > 0) ?? candidates[0];
  if (!pick) {
    throw new Error(
      "The authenticated account has no trips. Create one in Wanderlog or set WANDERLOG_TRIP_KEY.",
    );
  }
  return pick.key;
}
