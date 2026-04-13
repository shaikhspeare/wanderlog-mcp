import { TripCache } from "./cache/trip-cache.js";
import { loadConfig, type Config } from "./config.js";
import { RestClient } from "./transport/rest.js";
import { ShareDBPool } from "./transport/sharedb.js";

export type AppContext = {
  config: Config;
  rest: RestClient;
  pool: ShareDBPool;
  tripCache: TripCache;
  /** Populated by the startup auth probe. Used by mutation tools for `addedBy`. */
  userId?: number;
};

export function createContext(): AppContext {
  const config = loadConfig();
  const rest = new RestClient(config);
  const pool = new ShareDBPool(config);
  const tripCache = new TripCache(rest, pool);
  return { config, rest, pool, tripCache };
}
