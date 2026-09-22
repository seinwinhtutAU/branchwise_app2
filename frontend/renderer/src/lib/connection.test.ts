import { describe, expect, it } from "vitest";
import {
  getConnectionSnapshot,
  reportRequestFailure,
  reportRequestRetry,
  reportRequestSuccess,
} from "./connection";

describe("connection quality", () => {
  it("reports good, slow, poor, and offline as distinct states", () => {
    reportRequestSuccess(120);
    expect(getConnectionSnapshot().status).toBe("online");
    expect(getConnectionSnapshot().latencyMs).toBe(120);

    reportRequestSuccess(1_200);
    expect(getConnectionSnapshot().status).toBe("slow");

    reportRequestRetry();
    expect(getConnectionSnapshot().status).toBe("poor");

    reportRequestFailure();
    expect(getConnectionSnapshot().status).toBe("offline");
  });
});
