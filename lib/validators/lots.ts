import { z } from "zod";
import { geoJsonPolygonSchema, objectIdSchema, syncStatusSchema } from "@/lib/validators/common";

export const lotCreateSchema = z.object({
  ranchId: objectIdSchema,
  name: z.string().trim().min(1),
  geometry: geoJsonPolygonSchema.nullable().optional(),
});

export const lotPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  ixorigueLotId: z.string().trim().min(1).nullable().optional(),
  geometry: geoJsonPolygonSchema.nullable().optional(),
  syncStatus: syncStatusSchema.optional(),
  syncError: z.string().trim().nullable().optional(),
});
