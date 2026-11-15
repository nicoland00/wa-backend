import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn(), locations: vi.fn(), raw: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({ requireSessionUser: mocks.user }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.db }));
vi.mock("@/lib/ixorigue/client", () => ({ getAnimalsLocations: mocks.locations, ixorigueRawGet: mocks.raw }));
import { GET } from "./route";

const ranchId = new ObjectId();
const lotId = new ObjectId();
const animalId = new ObjectId();
let ranch: Record<string, unknown>;
let deviceId: string | null;
function request(end = "2026-11-14") { return new NextRequest(`http://localhost/api/admin/device-health?ranchId=${ranchId}&range=day&end=${end}`); }

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ role: "admin", userId: new ObjectId().toString() });
  deviceId = "device-1";
  ranch = { _id: ranchId, name: "Test ranch", ixorigueRanchId: "remote-ranch" };
  mocks.db.mockResolvedValue({ collection: (name: string) => ({
    findOne: async () => ranch,
    find: () => ({ sort: () => ({ toArray: async () => name === "lots"
      ? [{ _id: lotId, name: "Test lot" }]
      : [{ _id: animalId, lotId, earTagNumber: "123", ixorigueAnimalId: "remote-animal", deviceId, lifeStatus: "alive" }] }) }),
  }) });
  mocks.locations.mockResolvedValue([]);
  mocks.raw.mockResolvedValue([]);
});

describe("device health source failures", () => {
  it("returns a visible error instead of a successful zero score when authentication fails", async () => {
    mocks.locations.mockRejectedValue(new Error("Ixorigue token refresh failed: invalid_grant"));
    const response = await GET(request());
    const data = await response.json();
    expect(response.status).toBe(502);
    expect(data.code).toBe("ixorigue_auth");
    expect(data.lots).toBeUndefined();
    expect(data.error).not.toContain("invalid_grant");
  });
  it("reports a timeout without manufacturing no-ping data", async () => {
    mocks.locations.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const response = await GET(request());
    expect(response.status).toBe(504);
    expect((await response.json()).code).toBe("ixorigue_timeout");
  });
  it("distinguishes a successful empty history from an API failure", async () => {
    const response = await GET(request());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.telemetry).toMatchObject({ status: "empty", positionCount: 0 });
    expect(data.lots[0].animals[0].overallPct).toBe(0);
  });
  it("counts half-hour slots in ranch time and excludes invalid timestamps", async () => {
    mocks.locations.mockResolvedValue([{ animalId: "remote-animal", locations: [
      { timestamp: "2026-11-14T04:05:00Z" },
      { timestamp: "2026-11-14T04:20:00Z" },
      { timestamp: "2026-11-14T04:35:00Z" },
      { timestamp: "not-a-date" },
      { timestamp: "2026-11-14T03:55:00Z" },
    ] }]);
    const response = await GET(request());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.lots[0].animals[0].overallPingCount).toBe(2);
    expect(data.lots[0].animals[0].slots.slice(0, 3)).toEqual(["ok", "ok", "missing"]);
    expect(data.telemetry).toMatchObject({ status: "ok", positionCount: 3 });
  });
  it("does not erase successful activity when optional battery data fails", async () => {
    mocks.locations.mockResolvedValue([{ animalId: "remote-animal", locations: [{ timestamp: "2026-11-14T04:05:00Z" }] }]);
    mocks.raw.mockRejectedValue(new Error("battery endpoint unavailable"));
    const data = await (await GET(request())).json();
    expect(data.lots[0].animals[0].overallPingCount).toBe(1);
    expect(data.warnings).toHaveLength(1);
  });
  it("rejects malformed dates and unlinked ranches instead of showing zeros", async () => {
    expect((await GET(request("2026-02-31"))).status).toBe(400);
    ranch.ixorigueRanchId = null;
    expect((await GET(request())).status).toBe(409);
    expect(mocks.locations).not.toHaveBeenCalled();
  });
  it("does not count an animal without a device as a silent tracked device", async () => {
    deviceId = null;
    const data = await (await GET(request())).json();
    expect(data.lots[0].animals[0].hasDevice).toBe(false);
    expect(data.lots[0].animals[0].slots).toBeNull();
  });
  it("reports an unrecognized animal identifier response instead of zero activity", async () => {
    mocks.locations.mockResolvedValue([{ animalId: null, locations: [] }]);
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("ixorigue_response_format");
  });
});
