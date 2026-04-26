import { describe, expect, test } from "vitest";

import { withHandledTimeout } from "../src/lib/with-timeout.js";

describe("withHandledTimeout", () => {
  test("returns the resolved value before the timeout", async () => {
    await expect(
      withHandledTimeout(Promise.resolve("ok"), 20, () => new Error("timeout")),
    ).resolves.toBe("ok");
  });

  test("throws the timeout error while swallowing a later rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const lateReject = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("late failure")), 25);
      });

      await expect(
        withHandledTimeout(lateReject, 5, () => new Error("timeout")),
      ).rejects.toThrow("timeout");

      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
