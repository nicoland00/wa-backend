import type { Lot, LotFile } from "@/lib/api";

type LotPanelProps = {
  lot: Lot | null;
  files: LotFile[];
  onOpenFile?: (file: LotFile) => void;
};

export default function LotPanel({ lot, files, onOpenFile }: LotPanelProps) {
  return (
    <aside className="h-[520px] rounded-2xl bg-white p-5 shadow-sm">
      {/* Lot summary tied to the selected polygon in the map. */}
      <div className="mb-4 border-b border-slate-100 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detalle de lote</p>
        {lot ? (
          <>
            <h3 className="mt-2 text-xl font-semibold text-slate-800">{lot.name}</h3>
            <p className="mt-1 text-sm text-slate-500">ID Lote: {lot.lotId}</p>
            <p className="text-sm text-slate-500">Ixorigue: {lot.ixorigueId}</p>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Selecciona un lote en el mapa para ver su detalle.</p>
        )}
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Archivos asociados</p>
        <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "360px" }}>
          {files.length ? (
            files.map((file) => (
              <button
                key={file.importId}
                type="button"
                onClick={() => onOpenFile?.(file)}
                className="w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-left transition hover:border-slate-200 hover:bg-white"
              >
                <p className="truncate text-sm font-medium text-slate-700">{file.filename}</p>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                  <span>{file.assignedBy}</span>
                  <span className="capitalize">{file.status}</span>
                </div>
              </button>
            ))
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">
              No hay archivos para este lote.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
