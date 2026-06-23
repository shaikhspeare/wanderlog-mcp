import { describe, expect, it } from "vitest";
import { createContext } from "../../src/context.ts";
import { searchGuides } from "../../src/tools/search-guides.ts";
import { getGuide } from "../../src/tools/get-guide.ts";

const HAS_COOKIE = Boolean(process.env.WANDERLOG_COOKIE);

describe.skipIf(!HAS_COOKIE)(
  "wanderlog_search_guides + get_guide (integration)",
  () => {
    it(
      "lists guides for New York City and reads the first one",
      async () => {
        const ctx = createContext();
        const search = await searchGuides(ctx, { destination: "New York City" });
        expect(search.isError).toBeUndefined();
        const body = JSON.parse(search.content[0]!.text);
        expect(body.kind).toBe("guides");
        expect(body.guides.length).toBeGreaterThan(0);

        const firstKey = body.guides[0].guide_key;
        expect(typeof firstKey).toBe("string");
        expect(firstKey.length).toBeGreaterThan(0);

        const guide = await getGuide(ctx, { guide_key: firstKey });
        expect(guide.isError).toBeUndefined();
        expect(guide.content[0]!.text.length).toBeGreaterThan(50);
      },
      30_000,
    );
  },
);
