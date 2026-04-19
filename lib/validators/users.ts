import { z } from "zod";
import { e164Schema, objectIdSchema } from "@/lib/validators/common";

const roleSchema = z.enum(["admin", "institutional", "retail"]);

export const adminUserCreateSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1),
  role: roleSchema.default("retail"),
  phoneE164: e164Schema.nullable().optional(),
});

export const adminUserPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: roleSchema.optional(),
  phoneE164: e164Schema.nullable().optional(),
  ixorigueUserId: z.string().trim().min(1).nullable().optional(),
}).strict();

export const adminUserIdParamSchema = objectIdSchema;
