"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canManageUsers, canViewAdminScreens } from "@/lib/permissions";
import type { Role } from "@/lib/db/types";

type User = {
  _id: string;
  email: string;
  name: string | null;
  role: Role;
  phoneStatus: "none" | "pending" | "approved" | "rejected";
  phoneE164: string | null;
  ixorigueUserId?: string | null;
};

const roleOptions: Role[] = ["admin", "institutional", "retail"];

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role>>({});
  const [message, setMessage] = useState("");

  const canView = session ? canViewAdminScreens(session.user.role) : false;
  const canManage = session ? canManageUsers(session.user.role) : false;

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !canView) {
      return;
    }

    async function loadUsers() {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { users: User[] };
      setUsers(data.users);
      setRoleDrafts(
        Object.fromEntries(data.users.map((user) => [user._id, user.role])),
      );
    }

    void loadUsers();
  }, [canView, status]);

  async function updateUserRole(user: User) {
    const nextRole = roleDrafts[user._id];
    if (!nextRole || nextRole === user.role) {
      return;
    }

    const response = await fetch(`/api/admin/users/${user._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });

    const data = (await response.json()) as { error?: string; user?: User };
    setMessage(response.ok ? "User updated." : data.error ?? "Failed to update user.");

    if (response.ok && data.user) {
      setUsers((current) => current.map((item) => (item._id === user._id ? data.user as User : item)));
      setRoleDrafts((current) => ({ ...current, [user._id]: (data.user as User).role }));
    }
  }

  const pendingPhones = useMemo(
    () => users.filter((user) => user.phoneStatus === "pending").length,
    [users],
  );

  if (status === "loading") {
    return <main className="p-6 text-sm text-slate-600">Loading...</main>;
  }
  if (!canView) {
    return <main className="p-6 text-sm text-slate-600">Forbidden</main>;
  }

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">← Back</Link>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Users</h1>
              <p className="mt-1 text-sm text-slate-600">
                Users are created automatically when they sign in with Google for the first time.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/dashboard/admin/phones" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Phone approvals
              </Link>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {pendingPhones} pending
              </span>
            </div>
          </div>
          {!canManage ? (
            <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Institutional users can review this page but cannot change roles or user metadata.
            </p>
          ) : null}
          {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Phone status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isCurrentUser = session?.user.userId === user._id;
                  const draftRole = roleDrafts[user._id] ?? user.role;

                  return (
                    <tr key={user._id} className="border-b border-slate-100 text-slate-700">
                      <td className="px-3 py-2">{user.email}</td>
                      <td className="px-3 py-2">{user.name ?? "-"}</td>
                      <td className="px-3 py-2">
                        {canManage && !isCurrentUser ? (
                          <select
                            value={draftRole}
                            onChange={(event) => setRoleDrafts((current) => ({ ...current, [user._id]: event.target.value as Role }))}
                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          >
                            {roleOptions.map((role) => (
                              <option key={role} value={role}>{role}</option>
                            ))}
                          </select>
                        ) : (
                          <div>
                            <p>{user.role}</p>
                            {isCurrentUser ? <p className="text-xs text-slate-500">Current user</p> : null}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">{user.phoneE164 ?? "-"}</td>
                      <td className="px-3 py-2">{user.phoneStatus}</td>
                      <td className="px-3 py-2">
                        {canManage && !isCurrentUser ? (
                          <button
                            type="button"
                            onClick={() => void updateUserRole(user)}
                            disabled={draftRole === user.role}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-60"
                          >
                            Save role
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">
                            {isCurrentUser ? "Self role changes are blocked" : "Read only"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
