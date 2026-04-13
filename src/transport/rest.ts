import type { Config } from "../config.js";
import {
  WanderlogAuthError,
  WanderlogError,
  WanderlogNetworkError,
  WanderlogNotFoundError,
} from "../errors.js";
import type {
  Geo,
  PlaceData,
  PlaceSuggestion,
  TripPlan,
  TripPlanSummary,
  User,
} from "../types.js";

type Envelope<T> = { success?: boolean } & T;

export class RestClient {
  constructor(private readonly config: Config) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en",
      Cookie: this.config.cookieHeader,
      Origin: this.config.baseUrl,
      Referer: `${this.config.baseUrl}/`,
      "User-Agent": this.config.userAgent,
      ...extra,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown } = {},
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const init: Parameters<typeof fetch>[1] = {
      method,
      headers: this.headers(
        opts.body !== undefined ? { "Content-Type": "application/json" } : {},
      ),
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new WanderlogNetworkError(
        `Request to ${method} ${path} failed: ${(err as Error).message}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new WanderlogAuthError();
    }
    if (response.status === 404) {
      throw new WanderlogNotFoundError("Resource", path);
    }
    if (response.status >= 500) {
      throw new WanderlogError(
        `Wanderlog server error ${response.status} on ${path}`,
        "upstream_error",
        "This is a Wanderlog server issue; try again in a moment.",
      );
    }
    if (!response.ok) {
      throw new WanderlogError(
        `Unexpected response ${response.status} on ${method} ${path}`,
        "unexpected_status",
      );
    }

    try {
      return (await response.json()) as T;
    } catch (err) {
      throw new WanderlogError(
        `Failed to parse JSON from ${path}: ${(err as Error).message}`,
        "parse_error",
      );
    }
  }

  async getUser(): Promise<User> {
    const env = await this.request<Envelope<{ user?: User }>>("GET", "/api/user");
    if (!env.user || typeof env.user.id !== "number") {
      throw new WanderlogAuthError(
        "No user returned for current session — cookie may be invalid",
      );
    }
    return env.user;
  }

  async listTrips(): Promise<TripPlanSummary[]> {
    const env = await this.request<
      Envelope<{
        ownTripPlans?: TripPlanSummary[];
        friendsTripPlans?: TripPlanSummary[];
        friendsPrivateSharedTripPlans?: TripPlanSummary[];
      }>
    >("GET", "/api/tripPlans/home");

    return [
      ...(env.ownTripPlans ?? []),
      ...(env.friendsPrivateSharedTripPlans ?? []),
      ...(env.friendsTripPlans ?? []),
    ];
  }

  async getTrip(tripKey: string): Promise<TripPlan> {
    const { tripPlan } = await this.getTripWithResources(tripKey);
    return tripPlan;
  }

  async getTripWithResources(
    tripKey: string,
  ): Promise<{ tripPlan: TripPlan; geos: Geo[] }> {
    const env = await this.request<
      Envelope<{
        tripPlan?: TripPlan;
        resources?: { geos?: Geo[] };
      }>
    >(
      "GET",
      `/api/tripPlans/${encodeURIComponent(tripKey)}?clientSchemaVersion=2&registerView=true`,
    );
    if (!env.tripPlan) {
      throw new WanderlogNotFoundError("Trip", tripKey);
    }
    return { tripPlan: env.tripPlan, geos: env.resources?.geos ?? [] };
  }

  async searchPlacesAutocomplete(args: {
    input: string;
    sessionToken: string;
    location: { latitude: number; longitude: number };
    radius: number;
    language?: string;
  }): Promise<PlaceSuggestion[]> {
    const request = {
      input: args.input,
      sessiontoken: args.sessionToken,
      location: args.location,
      radius: args.radius,
      language: args.language ?? "en",
    };
    const qs = `request=${encodeURIComponent(JSON.stringify(request))}`;
    const env = await this.request<Envelope<{ data?: PlaceSuggestion[] }>>(
      "GET",
      `/api/placesAPI/autocomplete/v2?${qs}`,
    );
    return env.data ?? [];
  }

  async getPlaceDetails(placeId: string, language = "en"): Promise<PlaceData> {
    const env = await this.request<Envelope<{ data?: PlaceData }>>(
      "GET",
      `/api/placesAPI/getPlaceDetails/v2?placeId=${encodeURIComponent(placeId)}&language=${language}`,
    );
    if (!env.data) {
      throw new WanderlogNotFoundError("Place", placeId);
    }
    return env.data;
  }

  async geoAutocomplete(
    query: string,
  ): Promise<Array<{ id: number; name: string; countryName?: string; stateName?: string; latitude: number; longitude: number; popularity?: number }>> {
    const env = await this.request<Envelope<{ data?: Array<{ id: number; name: string; countryName?: string; stateName?: string; latitude: number; longitude: number; popularity?: number }> }>>(
      "GET",
      `/api/geo/autocomplete/${encodeURIComponent(query)}`,
    );
    return env.data ?? [];
  }

  async createTrip(args: {
    geoIds: number[];
    startDate: string;
    endDate: string;
    title?: string | null;
    privacy?: "private" | "friends" | "public";
  }): Promise<{ key: string; viewKey: string; id: number; title: string }> {
    const env = await this.request<
      Envelope<{
        data?: { key: string; viewKey: string; id: number; title: string };
      }>
    >("POST", "/api/tripPlans", {
      body: {
        geoIds: args.geoIds,
        initialMapsPlaceIds: [],
        initialEmailId: null,
        type: "plan",
        startDate: args.startDate,
        endDate: args.endDate,
        privacy: args.privacy ?? "private",
        isMapEmbed: false,
        title: args.title ?? null,
        language: "en",
      },
    });
    if (!env.data) {
      throw new WanderlogError("Trip creation returned no data", "create_failed");
    }
    return env.data;
  }

  async deleteTrip(tripKey: string): Promise<void> {
    await this.request<Envelope<{}>>(
      "DELETE",
      `/api/tripPlans/${encodeURIComponent(tripKey)}`,
    );
  }
}
