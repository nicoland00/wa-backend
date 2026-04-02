import { z } from "zod";
import { objectIdSchema } from "@/lib/validators/common";

export const createDataErrorRequestSchema = z.object({
  ranchId: objectIdSchema.nullable().optional(),
  lotId: objectIdSchema.nullable().optional(),
  animalId: objectIdSchema.nullable().optional(),
  message: z.string().trim().min(5),
});

export const resolveDataErrorRequestSchema = z.object({
  status: z.enum(["resolved", "rejected"]).default("resolved"),
});
