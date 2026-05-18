import { z } from "zod";
import type { AppContext } from "../context.js";
import type {
  GeoWithGoodGuides,
  GuideGeoRef,
  GuideSummary,
  GuidesForGeoResponse,
  WanderlogGuide,
} from "../types.js";
import {
  WanderlogError,
  WanderlogNotFoundError,
  WanderlogValidationError,
} from "../errors.js";

export const searchGuidesInputSchema = {
  destination: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Free-text destination (e.g. 'Vietnam', 'Kyoto'). Resolved via geoAutocomplete; multi-match auto-picks the highest-popularity geo and surfaces up to 2 candidates in 'alternative_geos'.",
    ),
  geo_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Explicit Wanderlog geo id (from a prior response's 'geo' or 'alternative_geos').",
    ),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe(
      "Output verbosity. 'concise' (default) returns guide_key, title, author, place_count, view_count. 'detailed' adds blurb, like_count, edited_at, distinction, profile_picture_url, header_image_url.",
    ),
};

export const searchGuidesDescription = `
Lists user-written Wanderlog travel guides for a destination — long-form recommendations and
itineraries other travellers have published. Use this when the user asks for inspiration, an
itinerary they can copy, or "what guides exist for X".

Specify exactly one of destination or geo_id. For free-text destinations the highest-popularity
match is picked; up to 2 candidates appear in 'alternative_geos' as a soft hint. When the
destination has no curated guides yet, the response carries 'alternative_geos_with_guides'
with the top 5 nearby destinations that do.

Pass the returned guide_key to wanderlog_get_guide to read the full content of one guide.
`.trim();

export type SearchGuidesArgs = {
  destination?: string;
  geo_id?: number;
  response_format?: "concise" | "detailed";
};

export function validateArgs(args: SearchGuidesArgs): SearchGuidesArgs & {
  response_format: "concise" | "detailed";
} {
  const modesSet = [args.destination !== undefined, args.geo_id !== undefined].filter(
    Boolean,
  ).length;
  if (modesSet !== 1) {
    throw new WanderlogValidationError(
      "Pass exactly one of destination or geo_id.",
    );
  }
  return { ...args, response_format: args.response_format ?? "concise" };
}

export async function resolveGeo(
  ctx: AppContext,
  args: Pick<SearchGuidesArgs, "destination" | "geo_id">,
): Promise<{ geo: GuideGeoRef; alternative_geos: GuideGeoRef[] }> {
  if (args.geo_id !== undefined) {
    // Trust the caller's geo_id. The canonical name/country/subcategory will
    // be filled in by getGuidesForGeo's embedded geo (or left as a stub if
    // the geo has no guides at all).
    return {
      geo: {
        geo_id: args.geo_id,
        name: "",
        country: null,
        subcategory: null,
      },
      alternative_geos: [],
    };
  }
  const candidates = await ctx.rest.geoAutocomplete(args.destination!);
  if (candidates.length === 0) {
    throw new WanderlogError(
      `No geo found matching "${args.destination}"`,
      "destination_not_found",
      {
        hint: "Try a more specific name (include the country) or pass an explicit geo_id from a prior search.",
        followUps: [
          "Retry wanderlog_search_guides with a more specific destination (include the country or region).",
        ],
      },
    );
  }
  const ranked = [...candidates].sort(
    (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0),
  );
  const top = ranked[0]!;
  const alternatives = ranked.slice(1, 3).map((c) => ({
    geo_id: c.id,
    name: c.name,
    country: c.countryName ?? null,
    subcategory: null,
  }));
  return {
    geo: {
      geo_id: top.id,
      name: top.name,
      country: top.countryName ?? null,
      subcategory: null,
    },
    alternative_geos: alternatives,
  };
}

const IMAGE_BASE = "https://wanderlog.com/image/upload";

let cachedGoodGuides: Promise<GeoWithGoodGuides[]> | null = null;

export function __resetCacheForTests(): void {
  cachedGoodGuides = null;
}

export function loadGoodGuides(ctx: AppContext): Promise<GeoWithGoodGuides[]> {
  if (!cachedGoodGuides) {
    cachedGoodGuides = ctx.rest.listGoodGuides().catch((err) => {
      cachedGoodGuides = null;
      throw err;
    });
  }
  return cachedGoodGuides;
}

function imageUrl(key: string | null | undefined): string | null {
  return key ? `${IMAGE_BASE}/${key}` : null;
}

export function projectGuide(
  g: WanderlogGuide,
  format: "concise" | "detailed",
): GuideSummary {
  const base: GuideSummary = {
    guide_key: g.key,
    title: g.title,
    author: g.user.username,
    place_count: g.placeCount ?? null,
    view_count: g.viewCount ?? null,
    like_count: g.likeCount ?? null,
    blurb: g.authorBlurb ?? null,
    url: `https://wanderlog.com/view/${g.key}`,
    edited_at: g.editedAt ?? null,
  };
  if (format === "concise") return base;
  return {
    ...base,
    author_name: g.user.name,
    profile_picture_url: imageUrl(g.user.profilePictureKey),
    distinction: g.distinction ?? null,
    header_image_url: imageUrl(g.headerImageKey),
  };
}

export function geoRef(g: GeoWithGoodGuides): GuideGeoRef {
  return {
    geo_id: g.id,
    name: g.name,
    country: g.countryName ?? null,
    subcategory: g.subcategory ?? null,
  };
}

export async function searchGuides(
  ctx: AppContext,
  args: SearchGuidesArgs,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const norm = validateArgs(args);
    const { geo: stub, alternative_geos } = await resolveGeo(ctx, norm);

    let guidesResp: GuidesForGeoResponse | null = null;
    try {
      guidesResp = await ctx.rest.getGuidesForGeo(stub.geo_id);
    } catch (err) {
      if (!(err instanceof WanderlogNotFoundError)) throw err;
    }

    if (!guidesResp || guidesResp.guides.length === 0) {
      const good = await loadGoodGuides(ctx);
      const top5 = [...good]
        .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
        .slice(0, 5)
        .map(geoRef);
      const resolved_geo: GuideGeoRef = guidesResp?.geo ? geoRef(guidesResp.geo) : stub;
      const body = {
        kind: "no_guides" as const,
        resolved_geo,
        alternative_geos_with_guides: top5,
      };
      return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
    }

    const projected = guidesResp.guides.map((g) =>
      projectGuide(g, norm.response_format),
    );
    const body = {
      kind: "guides" as const,
      geo: geoRef(guidesResp.geo),
      alternative_geos,
      returned: projected.length,
      total: projected.length,
      guides: projected,
    };
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  } catch (err) {
    const e =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: e }], isError: true };
  }
}
