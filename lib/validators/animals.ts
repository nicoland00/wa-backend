import { z } from "zod";
import { objectIdSchema, syncStatusSchema } from "@/lib/validators/common";

const optionalTrimmedString = z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
});

export const animalBaseSchema = z.object({
  lotId: objectIdSchema,
  specie: z.enum(["cow", "sheep", "goat", "pig", "horse", "donkey"]),
  name: z.string().trim().min(1),
  sex: z.enum(["female", "male", "steer"]),
  earTagNumber: z.string().trim().min(1),
  breed: optionalTrimmedString,
  color: optionalTrimmedString,
  brandNumber: optionalTrimmedString,
  deviceId: optionalTrimmedString,
  initialWeight: z.union([z.coerce.number().positive(), z.literal(""), z.null(), z.undefined()]).transform((value) => (
    typeof value === "number" && Number.isFinite(value) ? value : undefined
  )),
  birthDate: optionalTrimmedString,
  dateOfPurchase: optionalTrimmedString,
}).superRefine((value, ctx) => {
  const hasBirthDate = Boolean(value.birthDate);
  const hasPurchaseDate = Boolean(value.dateOfPurchase);

  if (hasBirthDate === hasPurchaseDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["birthDate"],
      message: "Provide either a birth date or a purchase date.",
    });
  }
});

export const animalPatchSchema = z.object({
  specie: z.enum(["cow", "sheep", "goat", "pig", "horse", "donkey"]).optional(),
  name: z.string().trim().min(1).optional(),
  sex: z.enum(["female", "male", "steer"]).optional(),
  breed: optionalTrimmedString,
  color: optionalTrimmedString,
  brandNumber: optionalTrimmedString,
  earTagNumber: z.string().trim().min(1).optional(),
  deviceId: optionalTrimmedString,
  birthDate: z.union([z.coerce.date(), z.null(), z.undefined()]).optional(),
  dateOfPurchase: z.union([z.coerce.date(), z.null(), z.undefined()]).optional(),
  registerReason: optionalTrimmedString,
  initialWeight: z.coerce.number().positive().optional(),
  currentWeight: z.coerce.number().positive().optional(),
  lifeStatus: z.enum(["alive", "dead"]).optional(),
  ixorigueAnimalId: z.string().trim().min(1).nullable().optional(),
  syncStatus: syncStatusSchema.optional(),
  syncError: z.string().trim().nullable().optional(),
  lotId: objectIdSchema.optional(),
});

export const animalWeightCreateSchema = z.object({
  weight: z.coerce.number().positive(),
  measuredAt: z.coerce.date().optional(),
});
