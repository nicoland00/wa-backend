import { describe, expect, it } from "vitest";
import { getWeightEvolution } from "./weight-evolution";

describe("weight evolution from the initial to latest weight", () => {
  it("uses neither the minimum, maximum nor penultimate weighing as the baseline", () => {
    const records = [
      { weight: 200, measuredAt: "2026-06-01" },
      { weight: 450, measuredAt: "2026-08-01" },
      { weight: 700, measuredAt: "2026-07-01" },
      { weight: 300, measuredAt: "2026-05-01" },
    ];
    expect(getWeightEvolution(records, 300)).toEqual({ initial: 300, latest: 450, difference: 150, percentage: 50 });
    expect(records[0].weight).toBe(200);
  });
  it("keeps the original weight even if the first available measurement is lower", () => {
    expect(getWeightEvolution([{ weight: 200, measuredAt: "2026-06-01" }], 300).difference).toBe(-100);
  });
  it("reports a total loss even when the last step was a gain", () => {
    expect(getWeightEvolution([{ weight: 200, measuredAt: "2026-06-01" }, { weight: 250, measuredAt: "2026-08-01" }], 500))
      .toEqual({ initial: 500, latest: 250, difference: -250, percentage: -50 });
  });
  it("falls back to the earliest dated measurement when no original weight is stored", () => {
    expect(getWeightEvolution([{ weight: 500, measuredAt: "2026-08-17" }, { weight: 300, measuredAt: "2026-05-15" }]).difference).toBe(200);
  });
  it("supports stored weights without inventing dated measurements", () => {
    expect(getWeightEvolution([], 300, 450).difference).toBe(150);
    expect(getWeightEvolution([], 0, 450).percentage).toBeNull();
  });
});
