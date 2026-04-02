import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Role } from "@/lib/db/types";

type AuditInput = {
  actorUserId: string;
  actorRole: Role;
  action: string;
  target: { type: string; id: string };
  before?: unknown;
  after?: unknown;
};

export async function logAudit(input: AuditInput) {
  const db = await getDb();

  await db.collection("audit_logs").insertOne({
    actorUserId: new ObjectId(input.actorUserId),
    actorRole: input.actorRole,
    action: input.action,
    target: input.target,
    before: input.before,
    after: input.after,
    createdAt: new Date(),
  });
}
