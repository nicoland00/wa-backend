import { z } from "zod";
import { objectIdSchema, syncStatusSchema } from "@/lib/validators/common";

export const ranchCreateSchema = z.object({
  ownerUserId: objectIdSchema,
  name: z.string().trim().min(1),
  ixorigueRanchId: z.string().trim().min(1),
});

export const ranchAssignSchema = z.object({
  ownerUserId: objectIdSchema,
  ixorigueRanchId: z.string().trim().min(1),
});

export const ranchPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  ixorigueRanchId: z.string().trim().min(1).nullable().optional(),
  syncStatus: syncStatusSchema.optional(),
  syncError: z.string().trim().nullable().optional(),
});
