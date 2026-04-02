"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type User = {
  _id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
  phoneStatus: "none" | "pending" | "approved" | "rejected";
  phoneE164: string | null;
  ixorigueUserId?: string | null;
};

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ email: "", name: "", role: "user", phoneE164: "" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || session?.user.role !== "admin") {
      return;
    }

    async function loadUsers() {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { users: User[] };
      setUsers(data.users);
    }

    void loadUsers();
  }, [session?.user.role, status]);

  async function createUser() {
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.email,
        name: form.name,
        role: form.role,
        phoneE164: form.phoneE164 || null,
      }),
    });

    const data = (await response.json()) as { error?: string; user?: User };
    setMessage(response.ok ? "User created." : data.error ?? "Failed to create user.");
    if (response.ok && data.user) {
      const user = data.user;
      setUsers((current) => [user, ...current]);
      setForm({ email: "", name: "", role: "user", phoneE164: "" });
    }
  }

  async function updateUser(user: User, patch: Partial<User>) {
    const response = await fetch(`/api/admin/users/${user._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = (await response.json()) as { error?: string; user?: User };
    setMessage(response.ok ? "User updated." : data.error ?? "Failed to update user.");
    if (response.ok && data.user) {
      setUsers((current) => current.map((item) => (item._id === user._id ? data.user as User : item)));
    }
  }

  if (status === "loading") {
    return <main className="p-6 text-sm text-slate-600">Loading...</main>;
  }
  if (session?.user.role !== "admin") {
    return <main className="p-6 text-sm text-slate-600">Forbidden</main>;
  }

  return (
    <main className="min-h-screen bg-[#f7f9fb] p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">← Back</Link>
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Users</h1>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="Email" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <input value={form.phoneE164} onChange={(event) => setForm((current) => ({ ...current, phoneE164: event.target.value }))} placeholder="+549..." className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <button type="button" onClick={() => void createUser()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">Create</button>
            </div>
          </div>
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
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user._id} className="border-b border-slate-100 text-slate-700">
                    <td className="px-3 py-2">{user.email}</td>
                    <td className="px-3 py-2">{user.name ?? "-"}</td>
                    <td className="px-3 py-2">{user.role}</td>
                    <td className="px-3 py-2">{user.phoneE164 ?? "-"}</td>
                    <td className="px-3 py-2">{user.phoneStatus}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void updateUser(user, { role: user.role === "admin" ? "user" : "admin" })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">
                          Toggle role
                        </button>
                        <button type="button" onClick={() => void updateUser(user, { phoneStatus: "approved" })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">
                          Approve phone
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
