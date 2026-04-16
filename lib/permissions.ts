import type { Role, StoredRole } from "@/lib/db/types";

type RoleLike = Role | StoredRole | string | null | undefined;

function pickRole(input: RoleLike | { role: RoleLike }): RoleLike {
  if (typeof input === "object" && input !== null && "role" in input) {
    return input.role;
  }
  return input;
}

export function normalizeRole(input: RoleLike | { role: RoleLike }): Role {
  const role = pickRole(input);

  if (role === "admin" || role === "institutional" || role === "retail") {
    return role;
  }

  return "retail";
}

export function isAdminRole(input: RoleLike | { role: RoleLike }): boolean {
  return normalizeRole(input) === "admin";
}

export function canViewAdminScreens(input: RoleLike | { role: RoleLike }): boolean {
  const role = normalizeRole(input);
  return role === "admin" || role === "institutional";
}

export function canMutateAdminData(input: RoleLike | { role: RoleLike }): boolean {
  return normalizeRole(input) === "admin";
}

export function canManageUsers(input: RoleLike | { role: RoleLike }): boolean {
  return normalizeRole(input) === "admin";
}

export function canApprovePhones(input: RoleLike | { role: RoleLike }): boolean {
  return normalizeRole(input) === "admin";
}

export function canOwnAssignedRanches(input: RoleLike | { role: RoleLike }): boolean {
  return normalizeRole(input) === "retail";
}

