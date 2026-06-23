import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import {
  __resetCacheForTests,
  loadGoodGuides,
  projectGuide,
  resolveGeo,
  searchGuides,
} from "../../src/tools/search-guides.ts";
import type { GeoWithGoodGuides, GuidesForGeoResponse, WanderlogGuide } from "../../src/types.ts";

function fakeCtx(overrides: Partial<AppContext["rest"]> = {}): AppContext {
  return {
    rest: {
      geoAutocomplete: async () => [],
      listGoodGuides: async () => [],
      ...overrides,
    },
  } as unknown as AppContext;
}

describe("search-guides resolveGeo", () => {
  it("auto-picks highest-popularity candidate and returns top 2 as alternatives", async () => {
    const ctx = fakeCtx({
      geoAutocomplete: async () => [
        { id: 1, name: "Vietnam", countryName: null, popularity: 5, latitude: 0, longitude: 0 },
        { id: 2, name: "Vietnam", countryName: null, popularity: 95, latitude: 0, longitude: 0 },
        { id: 3, name: "Vietnam-ish", countryName: null, popularity: 50, latitude: 0, longitude: 0 },
      ],
    });
    const result = await resolveGeo(ctx, { destination: "Vietnam" });
    expect(result.geo.geo_id).toBe(2);
    expect(result.alternative_geos.map((g) => g.geo_id)).toEqual([3, 1]);
  });

  it("throws destination_not_found when geoAutocomplete returns []", async () => {
    const ctx = fakeCtx({ geoAutocomplete: async () => [] });
    await expect(resolveGeo(ctx, { destination: "Nowhere" })).rejects.toMatchObject({
      code: "destination_not_found",
    });
  });

  it("returns stub geo for explicit geo_id (handler fills in canonical name from getGuidesForGeo)", async () => {
    const ctx = fakeCtx({});
    const result = await resolveGeo(ctx, { geo_id: 86655 });
    expect(result.geo.geo_id).toBe(86655);
    expect(result.geo.name).toBe("");
    expect(result.alternative_geos).toEqual([]);
  });
});

describe("loadGoodGuides cache", () => {
  it("calls listGoodGuides once across multiple invocations", async () => {
    __resetCacheForTests();
    let calls = 0;
    const sample: GeoWithGoodGuides[] = [
      { id: 86655, name: "Vietnam", popularity: 100, subcategory: "country" },
    ];
    const ctx = {
      rest: {
        listGoodGuides: async () => {
          calls++;
          return sample;
        },
      },
    } as unknown as AppContext;

    const first = await loadGoodGuides(ctx);
    const second = await loadGoodGuides(ctx);
    expect(first).toBe(second);
    expect(calls).toBe(1);
  });

  it("clears the cached promise when the underlying call fails so the next call retries", async () => {
    __resetCacheForTests();
    let calls = 0;
    const ctx = {
      rest: {
        listGoodGuides: async () => {
          calls++;
          if (calls === 1) throw new Error("network down");
          return [];
        },
      },
    } as unknown as AppContext;

    await expect(loadGoodGuides(ctx)).rejects.toThrow(/network down/);
    await loadGoodGuides(ctx); // second call should re-invoke
    expect(calls).toBe(2);
  });
});

describe("projectGuide", () => {
  const raw: WanderlogGuide = {
    id: 5325079,
    keyType: "view",
    key: "nlcviusycz",
    journalKey: "x",
    type: "recommendations",
    title: "Japan: Video Game Guide",
    user: {
      id: 157169,
      username: "pham2ez",
      name: "2e",
      profilePictureKey: "Vlp9auuKUEkRrlRR",
    },
    placeCount: 114,
    viewCount: 186566,
    likeCount: 2624,
    editedAt: "2026-05-03T02:05:37+00:00",
    distinction: "verified",
    authorBlurb: "I love Japan.",
    headerImageKey: "yitfaNaah1Cxyrnht6TDK7dxn2U1EtMW",
  };

  it("concise projection keeps essentials, blurb, like_count, url, and edited_at", () => {
    const p = projectGuide(raw, "concise");
    expect(p.guide_key).toBe("nlcviusycz");
    expect(p.title).toBe("Japan: Video Game Guide");
    expect(p.author).toBe("pham2ez");
    expect(p.place_count).toBe(114);
    expect(p.view_count).toBe(186566);
    expect(p.like_count).toBe(2624);
    expect(p.blurb).toBe("I love Japan.");
    expect(p.url).toBe("https://wanderlog.com/view/nlcviusycz");
    expect(p.edited_at).toBe("2026-05-03T02:05:37+00:00");
    // 'detailed' fields stay undefined in concise mode:
    expect(p.author_name).toBeUndefined();
    expect(p.profile_picture_url).toBeUndefined();
    expect(p.header_image_url).toBeUndefined();
    expect(p.distinction).toBeUndefined();
  });

  it("detailed projection adds author_name, distinction, profile + header image URLs", () => {
    const p = projectGuide(raw, "detailed");
    // base fields still present
    expect(p.blurb).toBe("I love Japan.");
    expect(p.like_count).toBe(2624);
    expect(p.url).toBe("https://wanderlog.com/view/nlcviusycz");
    expect(p.edited_at).toBe("2026-05-03T02:05:37+00:00");
    // detailed-only:
    expect(p.author_name).toBe("2e");
    expect(p.distinction).toBe("verified");
    expect(p.profile_picture_url).toMatch(/Vlp9auuKUEkRrlRR/);
    expect(p.header_image_url).toMatch(/yitfaNaah1Cxyrnht6TDK7dxn2U1EtMW/);
  });

  it("nulls and missing fields stay null/undefined gracefully", () => {
    const sparse: WanderlogGuide = {
      id: 1,
      keyType: "view",
      key: "abc",
      type: "recommendations",
      title: "Stub",
      user: { id: 0, username: "u", name: "U" },
    };
    const p = projectGuide(sparse, "concise");
    expect(p.place_count).toBeNull();
    expect(p.view_count).toBeNull();
  });
});

function handlerCtx(
  overrides: Partial<AppContext["rest"]> = {},
): AppContext {
  return {
    rest: {
      geoAutocomplete: async () => [],
      listGoodGuides: async () => [] as GeoWithGoodGuides[],
      getGuidesForGeo: async (): Promise<GuidesForGeoResponse> => ({
        geo: { id: 0, name: "" } as GeoWithGoodGuides,
        guides: [],
      }),
      ...overrides,
    },
  } as unknown as AppContext;
}

describe("searchGuides (handler)", () => {
  it("rejects when neither destination nor geo_id is set", async () => {
    __resetCacheForTests();
    const res = await searchGuides(handlerCtx(), {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/exactly one of/i);
  });

  it("rejects when both modes are set", async () => {
    __resetCacheForTests();
    const res = await searchGuides(handlerCtx(), {
      destination: "Vietnam",
      geo_id: 86655,
    });
    expect(res.isError).toBe(true);
  });

  it("returns kind=guides with projected entries when geo has guides", async () => {
    __resetCacheForTests();
    const goodGuides: GeoWithGoodGuides[] = [
      { id: 86655, name: "Vietnam", subcategory: "country", popularity: 0 },
    ];
    const guide: WanderlogGuide = {
      id: 1,
      keyType: "view",
      key: "abc",
      type: "recommendations",
      title: "Vietnam Loop",
      user: { id: 1, username: "u", name: "U" },
      placeCount: 42,
      viewCount: 1234,
    };
    const ctx = handlerCtx({
      geoAutocomplete: async () => [
        { id: 86655, name: "Vietnam", countryName: null, popularity: 100, latitude: 0, longitude: 0 },
      ],
      listGoodGuides: async () => goodGuides,
      getGuidesForGeo: async () => ({ geo: goodGuides[0]!, guides: [guide] }),
    });
    const res = await searchGuides(ctx, { destination: "Vietnam" });
    expect(res.isError).toBeUndefined();
    const body = JSON.parse(res.content[0]!.text);
    expect(body.kind).toBe("guides");
    expect(body.geo.geo_id).toBe(86655);
    expect(body.guides).toHaveLength(1);
    expect(body.guides[0].guide_key).toBe("abc");
    expect(body.guides[0].title).toBe("Vietnam Loop");
  });

  it("returns kind=no_guides with up-to-5 alternatives when getGuidesForGeo returns no guides", async () => {
    __resetCacheForTests();
    const goodGuides: GeoWithGoodGuides[] = [
      { id: 86647, name: "Japan", subcategory: "country", popularity: 0 },
      { id: 9614, name: "Paris", countryName: "France", subcategory: "city", popularity: 857235 },
      { id: 9613, name: "London", countryName: "United Kingdom", subcategory: "city", popularity: 1055882 },
      { id: 58144, name: "New York City", countryName: "United States", subcategory: "city", popularity: 1056637 },
      { id: 9625, name: "Amsterdam", countryName: "The Netherlands", subcategory: "city", popularity: 400126 },
      { id: 88419, name: "Iceland", subcategory: "country", popularity: 0 },
    ];
    const ctx = handlerCtx({
      geoAutocomplete: async () => [
        { id: 9999, name: "Smalltown", countryName: "X", popularity: 10, latitude: 0, longitude: 0 },
      ],
      listGoodGuides: async () => goodGuides,
      // Simulate Wanderlog returning no guides for this geo: 404 → throw.
      getGuidesForGeo: async () => {
        throw new (await import("../../src/errors.ts")).WanderlogNotFoundError("Guides", "9999");
      },
    });
    const res = await searchGuides(ctx, { destination: "Smalltown" });
    expect(res.isError).toBeUndefined();
    const body = JSON.parse(res.content[0]!.text);
    expect(body.kind).toBe("no_guides");
    expect(body.resolved_geo.geo_id).toBe(9999);
    expect(body.alternative_geos_with_guides).toHaveLength(5);
    // Highest popularity first:
    expect(body.alternative_geos_with_guides[0].name).toBe("New York City");
  });

  it("returns kind=guides for a destination that is NOT in the curated list but DOES have user guides (Bangkok case)", async () => {
    __resetCacheForTests();
    const goodGuides: GeoWithGoodGuides[] = [
      { id: 86647, name: "Japan", subcategory: "country", popularity: 0 },
    ];
    const bangkokGeo: GeoWithGoodGuides = {
      id: 4,
      name: "Bangkok",
      countryName: "Thailand",
      subcategory: "city",
      popularity: 347007,
    };
    const guide: WanderlogGuide = {
      id: 163218,
      keyType: "view",
      key: "vyxcbmqruh",
      type: "recommendations",
      title: "Bangkok, Thailand Guide",
      user: { id: 87618, username: "sams", name: "Sam's Thailand Travels" },
      placeCount: 77,
      viewCount: 20320,
    };
    const ctx = handlerCtx({
      geoAutocomplete: async () => [
        { id: 4, name: "Bangkok", countryName: "Thailand", popularity: 347007, latitude: 0, longitude: 0 },
      ],
      listGoodGuides: async () => goodGuides,
      getGuidesForGeo: async () => ({ geo: bangkokGeo, guides: [guide] }),
    });
    const res = await searchGuides(ctx, { destination: "Bangkok" });
    expect(res.isError).toBeUndefined();
    const body = JSON.parse(res.content[0]!.text);
    expect(body.kind).toBe("guides");
    expect(body.geo.geo_id).toBe(4);
    expect(body.geo.name).toBe("Bangkok");
    expect(body.geo.country).toBe("Thailand");
    expect(body.geo.subcategory).toBe("city");
    expect(body.guides[0].guide_key).toBe("vyxcbmqruh");
  });

  it("concise format includes blurb/like_count/url but omits detailed-only fields", async () => {
    __resetCacheForTests();
    const goodGuides: GeoWithGoodGuides[] = [
      { id: 86655, name: "Vietnam", subcategory: "country", popularity: 0 },
    ];
    const guide: WanderlogGuide = {
      id: 1,
      keyType: "view",
      key: "abc",
      type: "recommendations",
      title: "Vietnam Loop",
      user: { id: 1, username: "u", name: "U" },
      authorBlurb: "loved it",
      likeCount: 9,
      distinction: "promotable",
    };
    const ctx = handlerCtx({
      listGoodGuides: async () => goodGuides,
      getGuidesForGeo: async () => ({ geo: goodGuides[0]!, guides: [guide] }),
    });
    const res = await searchGuides(ctx, { geo_id: 86655, response_format: "concise" });
    const body = JSON.parse(res.content[0]!.text);
    // Always-present in concise:
    expect(body.guides[0].blurb).toBe("loved it");
    expect(body.guides[0].like_count).toBe(9);
    expect(body.guides[0].url).toBe("https://wanderlog.com/view/abc");
    // edited_at is now in concise; without a wire value it's null:
    expect(body.guides[0].edited_at).toBeNull();
    // Detailed-only fields remain undefined:
    expect(body.guides[0].author_name).toBeUndefined();
    expect(body.guides[0].distinction).toBeUndefined();
  });
});
