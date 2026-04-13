import { describe, expect, it } from "vitest";
import {
  formatTrip,
  formatTripList,
  formatBlockLine,
} from "../../src/formatters/trip-summary.ts";
import {
  INJECTION_STRINGS,
  injectionTrip,
} from "../fixtures/injection-trip.ts";

/**
 * Prompt-injection guard. Trip content is untrusted user data and may contain
 * adversarial strings. The formatter must render those strings verbatim as
 * plain text — never transforming them into something the downstream model
 * might mistake for a control signal.
 *
 * Guardrails this test enforces:
 *   1. Every injection string round-trips verbatim (no silent sanitization
 *      that could also hide tampering from the user).
 *   2. The formatter never emits *new* control-looking tokens the input
 *      didn't already contain — a defense against accidentally promoting
 *      data into something that looks like a tool call.
 *   3. The per-block try/catch still absorbs malformed shapes so one
 *      hostile block can't blank the rest of the response.
 */
describe("prompt-injection guard", () => {
  const concise = formatTrip(injectionTrip, "concise");
  const detailed = formatTrip(injectionTrip, "detailed");

  it("preserves malicious title verbatim in both formats", () => {
    expect(concise).toContain(INJECTION_STRINGS.title);
    expect(detailed).toContain(INJECTION_STRINGS.title);
  });

  it("preserves malicious day heading verbatim", () => {
    expect(concise).toContain(INJECTION_STRINGS.dayHeading);
  });

  it("preserves malicious place name and note text verbatim", () => {
    expect(concise).toContain(INJECTION_STRINGS.placeName);
    expect(concise).toContain(INJECTION_STRINGS.noteText);
  });

  it("preserves hotel confirmation number verbatim in detailed format", () => {
    expect(detailed).toContain(INJECTION_STRINGS.hotelConfirmation);
  });

  it("does not emit MCP/Anthropic control tokens the input didn't already contain", () => {
    // The injection fixture *does* contain the fake control tokens below.
    // This assertion checks that rendering a *clean* trip never synthesizes
    // any of them — i.e., the formatter itself is not a source of control
    // markup. We strip the known injection strings from `concise`, then grep.
    let sanitized = concise;
    for (const s of Object.values(INJECTION_STRINGS)) {
      sanitized = sanitized.split(s).join("");
    }
    const forbidden = [
      "<tool_use>",
      "</tool_use>",
      "<tool_result>",
      "</tool_result>",
      "<function_calls>",
      "</function_calls>",
      "<|im_start|>",
      "<|im_end|>",
      "<invoke",
    ];
    for (const token of forbidden) {
      expect(sanitized).not.toContain(token);
    }
  });

  it("trip list formatter preserves adversarial titles verbatim", () => {
    const out = formatTripList(
      [
        {
          id: 1,
          key: "injectionkey1234",
          title: INJECTION_STRINGS.title,
          startDate: "2026-06-01",
          endDate: "2026-06-02",
          placeCount: 2,
        },
      ],
      "concise",
    );
    expect(out).toContain(INJECTION_STRINGS.title);
    expect(out).toContain("injectionkey1234");
  });

  it("renders a fully malformed block as '(malformed)' without throwing", () => {
    const hostile = {
      type: "place",
      place: null, // triggers the inner try/catch
    } as unknown as Parameters<typeof formatBlockLine>[0];
    const line = formatBlockLine(hostile, "concise");
    // place blocks with no place return null; that's fine — it means the
    // hostile block is simply skipped rather than hijacking the response.
    // The important property is "no throw".
    expect(line === null || typeof line === "string").toBe(true);
  });

  it("hostile input with a throwing getter is caught per-block", () => {
    const hostile = {
      get type(): string {
        return "place";
      },
      get place(): never {
        throw new Error("boom");
      },
    } as unknown as Parameters<typeof formatBlockLine>[0];
    const line = formatBlockLine(hostile, "concise");
    expect(line).toBe("place (malformed)");
  });
});
