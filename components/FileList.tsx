import type { LotFile } from "@/lib/api";

type FileListProps = {
  files: LotFile[];
  onFileClick: (file: LotFile) => void;
};

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function FileList({ files, onFileClick }: FileListProps) {
  return (
    <div className="space-y-3">
      {files.length ? (
        files.map((file) => (
          <button
            key={file.importId}
            type="button"
            onClick={() => onFileClick(file)}
            className="w-full rounded-2xl bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow"
          >
            {/* File card view used in the Archivos tab. */}
            <p className="truncate text-sm font-semibold text-slate-800">{file.filename}</p>
            <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
              <p>Fecha: {dateFormatter.format(file.createdAt)}</p>
              <p>Asignado por: {file.assignedBy}</p>
              <p>Estado: <span className="capitalize">{file.status}</span></p>
              <p>ID: {file.importId}</p>
            </div>
          </button>
        ))
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Este lote no tiene archivos cargados.
        </div>
      )}
    </div>
  );
}
