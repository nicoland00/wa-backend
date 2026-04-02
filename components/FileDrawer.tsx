"use client";

import type { LotFile } from "@/lib/api";

type FileDrawerProps = {
  file: LotFile | null;
  open: boolean;
  onClose: () => void;
};

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "full",
  timeStyle: "short",
});

export default function FileDrawer({ file, open, onClose }: FileDrawerProps) {
  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-900/20 transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
      />
      <aside
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white p-6 shadow-2xl transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Drawer with complete file details. */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Archivo</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-800">{file?.filename ?? "Sin selección"}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-600 transition hover:bg-slate-50"
          >
            Cerrar
          </button>
        </div>

        {file ? (
          <div className="mt-6 space-y-4 text-sm text-slate-600">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="font-medium text-slate-700">ID de importación</p>
              <p className="mt-1">{file.importId}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="font-medium text-slate-700">Lote</p>
              <p className="mt-1">{file.lotId}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="font-medium text-slate-700">Fecha</p>
              <p className="mt-1">{dateFormatter.format(file.createdAt)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="font-medium text-slate-700">Asignado por</p>
              <p className="mt-1">{file.assignedBy}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="font-medium text-slate-700">Estado</p>
              <p className="mt-1 capitalize">{file.status}</p>
            </div>
          </div>
        ) : (
          <p className="mt-6 text-sm text-slate-500">Selecciona un archivo para ver los detalles.</p>
        )}
      </aside>
    </>
  );
}
