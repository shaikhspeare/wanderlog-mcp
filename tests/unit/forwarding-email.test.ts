import { describe, expect, it } from "vitest";
import { tripForwardingEmail } from "../../src/forwarding-email.js";

describe("tripForwardingEmail", () => {
  it("uses the trip+<id>@wanderlog.com pattern", () => {
    expect(tripForwardingEmail(17986391)).toBe("trip+17986391@wanderlog.com");
    expect(tripForwardingEmail(1)).toBe("trip+1@wanderlog.com");
  });
});
