export type ErrorOptions = {
  hint?: string;
  followUps?: string[];
};

export class WanderlogError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly followUps?: string[];

  constructor(
    message: string,
    code: string,
    hintOrOptions?: string | ErrorOptions,
  ) {
    super(message);
    this.name = "WanderlogError";
    this.code = code;
    if (typeof hintOrOptions === "string") {
      this.hint = hintOrOptions;
    } else if (hintOrOptions) {
      this.hint = hintOrOptions.hint;
      this.followUps = hintOrOptions.followUps;
    }
  }

  /**
   * Render the error for the calling agent. Includes the hint (human advice)
   * and a "Next steps" list of suggested follow-up tool calls when present.
   * Follow-ups are phrased as concrete actions the model can take without
   * asking the user for more information.
   */
  toUserMessage(): string {
    const parts: string[] = [this.message];
    if (this.hint) parts.push("", this.hint);
    if (this.followUps && this.followUps.length > 0) {
      parts.push("", "Next steps:");
      for (const step of this.followUps) {
        parts.push(`• ${step}`);
      }
    }
    return parts.join("\n");
  }
}

export class WanderlogAuthError extends WanderlogError {
  constructor(message = "Wanderlog session invalid or expired") {
    super(message, "auth_expired", {
      hint: "Capture a fresh connect.sid cookie from wanderlog.com DevTools (Application → Cookies) and update WANDERLOG_COOKIE in your MCP config.",
      followUps: [
        "Ask the user to refresh WANDERLOG_COOKIE in the MCP config, then restart the server.",
      ],
    });
    this.name = "WanderlogAuthError";
  }
}

export class WanderlogNotFoundError extends WanderlogError {
  constructor(resource: string, identifier?: string) {
    const id = identifier ? ` '${identifier}'` : "";
    const res = resource.toLowerCase();
    const options: ErrorOptions =
      res === "trip"
        ? {
            hint: "Use wanderlog_list_trips to see available trips.",
            followUps: [
              "Call wanderlog_list_trips to find the correct trip_key, then retry this tool with that key.",
            ],
          }
        : res === "place"
          ? {
              hint: "Try a more specific name or use wanderlog_search_places to find the exact place.",
              followUps: [
                "Call wanderlog_search_places with a broader query to see candidates.",
                "Retry this tool with a more specific place name (include the city or neighborhood).",
              ],
            }
          : {};
    super(`${resource}${id} not found`, "not_found", options);
    this.name = "WanderlogNotFoundError";
  }
}

export class WanderlogValidationError extends WanderlogError {
  constructor(message: string, hintOrOptions?: string | ErrorOptions) {
    super(message, "validation", hintOrOptions);
    this.name = "WanderlogValidationError";
  }
}

export class WanderlogNetworkError extends WanderlogError {
  constructor(message: string) {
    super(message, "network", {
      hint: "Check your internet connection and that wanderlog.com is reachable.",
      followUps: ["Retry the same tool call in a moment."],
    });
    this.name = "WanderlogNetworkError";
  }
}
