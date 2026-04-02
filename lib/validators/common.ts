import { z } from "zod";

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");
export const e164Schema = z.string().regex(/^\+[1-9]\d{1,14}$/, "Invalid E.164 phone");
export const syncStatusSchema = z.enum(["pending", "synced", "failed"]);
export const geoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
});
