import { describe, expect, it } from "vitest";
import { mapCreateAnimalPayload, summarizeAnimalCreateMultipart } from "@/lib/ixorigue/mappers";
import type { IxorigueAnimalUpsertInput } from "@/lib/ixorigue/types";

function baseInput(overrides: Partial<IxorigueAnimalUpsertInput> = {}): IxorigueAnimalUpsertInput {
  return {
    localAnimalId: "local-1",
    ixorigueRanchId: "89228e7c-6e99-492e-b085-b06edfc731b5",
    ixorigueLotId: "0fa8d062-1f50-44fb-a4c2-8967964cbad5",
    earTagNumber: "5051",
    specie: "cow",
    sex: "male",
    breed: "CAR",
    name: "Test",
    registerReason: "birth",
    birthDate: "2020-01-15",
    ...overrides,
  };
}

describe("mapCreateAnimalPayload", () => {
  it("sets required Ixorigue multipart fields (PascalCase)", () => {
    const fd = mapCreateAnimalPayload(baseInput());
    expect(fd.get("Specie")).toBe("cow");
    expect(fd.get("Name")).toBe("Test");
    expect(fd.get("EarTag")).toBe("5051");
    expect(fd.get("Sex")).toBe("male");
    expect(fd.get("Race")).toBe("CAR");
    expect(fd.get("RegisterReason")).toBe("birth");
    expect(fd.get("BirthDate")).toBe("2020-01-15");
  });

  it("normalizes sex to lowercase", () => {
    const fd = mapCreateAnimalPayload(baseInput({ sex: "FEMALE" }));
    expect(fd.get("Sex")).toBe("female");
  });

  it("summarizeAnimalCreateMultipart lists all keys for debugging", () => {
    const summary = summarizeAnimalCreateMultipart(baseInput());
    expect(Object.keys(summary).sort()).toContain("Specie");
    expect(Object.keys(summary).sort()).toContain("EarTag");
    expect(summary["Race"]).toBe("CAR");
  });
});
