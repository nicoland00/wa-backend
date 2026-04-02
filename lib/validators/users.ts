import { z } from "zod";
import { e164Schema, objectIdSchema } from "@/lib/validators/common";

export const adminUserCreateSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1),
  role: z.enum(["admin", "user"]).default("user"),
  phoneE164: e164Schema.nullable().optional(),
});

export const adminUserPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(["admin", "user"]).optional(),
  phoneE164: e164Schema.nullable().optional(),
  phoneStatus: z.enum(["none", "pending", "approved", "rejected"]).optional(),
  ixorigueUserId: z.string().trim().min(1).nullable().optional(),
});

export const adminUserIdParamSchema = objectIdSchema;
