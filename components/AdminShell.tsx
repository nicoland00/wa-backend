"use client";

import Link from "next/link";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { canViewAdminScreens } from "@/lib/permissions";

type NavItem = { href: string; label: string; icon: "overview" | "animal" | "video" | "ranch" | "lot" | "users" | "phone" | "sync" | "device" | "settings" | "request"; adminOnly?: boolean };

const primaryItems: NavItem[] = [
  { href: "/dashboard", label: "Resumen", icon: "overview" },
  { href: "/dashboard/admin/animals", label: "Animales", icon: "animal" },
  { href: "/dashboard/admin/imports", label: "Vídeos", icon: "video" },
  { href: "/dashboard/admin/ranches", label: "Fincas", icon: "ranch" },
  { href: "/dashboard/admin/lots", label: "Lotes", icon: "lot" },
];

const secondaryItems: NavItem[] = [
  { href: "/dashboard/admin/users", label: "Usuarios", icon: "users", adminOnly: true },
  { href: "/dashboard/admin/phones", label: "Teléfonos", icon: "phone", adminOnly: true },
  { href: "/dashboard/admin/sync-jobs", label: "Sincronización", icon: "sync" },
  { href: "/dashboard/admin/device-health", label: "Dispositivos", icon: "device" },
  { href: "/dashboard/admin/data-error-requests", label: "Incidencias", icon: "request" },
  { href: "/dashboard/admin/ixorigue", label: "Configuración", icon: "settings", adminOnly: true },
];

function NavIcon({ name }: { name: NavItem["icon"] }) {
  const paths: Record<NavItem["icon"], React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    animal: <><path d="m5 7-2-3m16 3 2-3M6 7h12l2 5-3 8H7l-3-8Z" /><path d="M9 12h.01M15 12h.01M9 17h6" /></>,
    video: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3Z" /></>,
    ranch: <><path d="m3 10 9-7 9 7M5 9v12h14V9" /><path d="M9 21v-7h6v7" /></>,
    lot: <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16m6-14v16" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4.5" /></>,
    phone: <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M10 18h4" /></>,
    sync: <><path d="M20 7V3l-3 3a8 8 0 0 0-13 5M4 17v4l3-3a8 8 0 0 0 13-5M20 3h-4M4 21h4" /></>,
    device: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="9" cy="18" r="2" /></>,
    request: <><path d="M21 11a9 9 0 0 1-9 9H4l-2 2v-9A9 9 0 0 1 21 11Z" /><path d="M11.5 6v6m0 3h.01" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0">{paths[name]}</svg>;
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const canView = session ? canViewAdminScreens(session.user.role) : false;
  const isAdmin = session?.user.role === "admin";
  const activeItem = [...primaryItems, ...secondaryItems].find((item) => item.href === pathname);

  useEffect(() => {
    if (status === "unauthenticated" && pathname.startsWith("/dashboard/admin")) router.replace("/login");
  }, [pathname, router, status]);

  if (!pathname.startsWith("/dashboard/admin") && !canView) return <>{children}</>;
  if (status === "loading") return <div className="flex min-h-screen items-center justify-center bg-[#f6f7f4] text-sm text-slate-500" role="status">Cargando administración…</div>;
  if (!canView) return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f6f7f4] p-6 text-center"><p className="text-sm text-slate-600">No tienes acceso a la administración.</p><Link href="/dashboard" className="text-sm font-medium text-[#31574b] underline underline-offset-4">Volver al resumen</Link></div>;

  function renderLinks(items: NavItem[]) {
    return items.filter((item) => !item.adminOnly || isAdmin).map((item) => {
      const active = item.href === pathname;
      return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} onClick={() => setMobileMenuOpen(false)} className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3f7561] ${active ? "bg-[#e9efea] text-[#31574b]" : "text-slate-600 hover:bg-[#f3f5f1] hover:text-slate-900"}`}><NavIcon name={item.icon} />{item.label}</Link>;
    });
  }

  const navigation = <><div className="space-y-1">{renderLinks(primaryItems)}</div><div className="mb-3 mt-7 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Administración</div><div className="space-y-1">{renderLinks(secondaryItems)}</div></>;

  return (
    <div className="admin-shell min-h-screen bg-[#f6f7f4] text-slate-800 lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      <a href="#admin-content" className="sr-only z-[300] rounded-md bg-white p-3 text-sm text-[#31574b] focus:fixed focus:left-4 focus:top-4 focus:not-sr-only">Saltar al contenido</a>
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-[#e1e5e1] bg-white lg:flex" aria-label="Navegación de administración">
        <Link href="/dashboard" className="flex items-center gap-3 border-b border-[#e1e5e1] px-6 py-6 focus-visible:outline-2 focus-visible:outline-[#3f7561]"><Image src="/pastora-logo.png" alt="" width={44} height={37} priority /><span className="text-lg font-semibold tracking-tight text-[#31574b]">Pastora</span></Link>
        <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Principal">{navigation}</nav>
        <div className="border-t border-[#e1e5e1] p-4">
          <Link href="/dashboard/profile" className="block rounded-md px-2 py-2 focus-visible:outline-2 focus-visible:outline-[#3f7561]"><p className="truncate text-xs font-medium text-slate-700" title={session?.user.email ?? ""}>{session?.user.email}</p><p className="mt-1 text-[11px] text-slate-400">{isAdmin ? "Administrador" : "Consulta institucional"}</p></Link>
          <button type="button" onClick={() => void signOut({ callbackUrl: "/login" })} className="mt-1 w-full rounded-md px-2 py-2 text-left text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-[#3f7561]">Cerrar sesión</button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="border-b border-[#e1e5e1] bg-white">
          <div className="flex min-h-[65px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3"><Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight text-[#31574b] lg:hidden"><Image src="/pastora-logo.png" alt="" width={36} height={30} />Pastora</Link><span className="hidden text-xs text-slate-400 lg:inline">Administración</span><span className="hidden text-slate-300 lg:inline" aria-hidden="true">/</span><span className="text-xs font-medium text-slate-600">{activeItem?.label ?? "Administración"}</span></div>
            <button type="button" onClick={() => setMobileMenuOpen((open) => !open)} aria-expanded={mobileMenuOpen} aria-controls="admin-mobile-navigation" className="flex items-center gap-2 rounded-md border border-[#e1e5e1] px-3 py-2 text-xs text-slate-600 focus-visible:outline-2 focus-visible:outline-[#3f7561] lg:hidden"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d={mobileMenuOpen ? "m6 6 12 12M6 18 18 6" : "M4 6h16M4 12h16M4 18h16"} /></svg>{mobileMenuOpen ? "Cerrar" : "Menú"}</button>
            <span className="hidden text-xs text-slate-400 lg:inline">{isAdmin ? "Panel de administración" : "Acceso de consulta"}</span>
          </div>
          {mobileMenuOpen ? <nav id="admin-mobile-navigation" className="border-t border-[#e1e5e1] px-3 py-4 lg:hidden" aria-label="Principal móvil">{navigation}<div className="mt-4 flex items-center justify-between gap-3 border-t border-[#e1e5e1] pt-4"><Link href="/dashboard/profile" onClick={() => setMobileMenuOpen(false)} className="min-w-0 truncate px-3 text-xs text-slate-500">{session?.user.email}</Link><button type="button" onClick={() => void signOut({ callbackUrl: "/login" })} className="shrink-0 rounded-md px-3 py-2 text-xs text-slate-600">Cerrar sesión</button></div></nav> : null}
        </header>
        <div id="admin-content" tabIndex={-1} className="min-w-0 outline-none">{children}</div>
      </div>
    </div>
  );
}
