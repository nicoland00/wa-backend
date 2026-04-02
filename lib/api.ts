export type GeometryPolygon = {
  type: "Polygon";
  coordinates: number[][][];
};

export type Lot = {
  lotId: string;
  farmId: string;
  name: string;
  geometry: GeometryPolygon;
  ixorigueId: string;
};

export type LotFile = {
  importId: string;
  lotId: string;
  filename: string;
  createdAt: Date;
  assignedBy: string;
  status: "processed" | "pending";
};

export type Farm = {
  farmId: string;
  name: string;
};

const farms: Farm[] = [
  { farmId: "farm-santa-maria", name: "Estancia Santa Maria" },
  { farmId: "farm-la-pradera", name: "La Pradera" },
];

const lots: Lot[] = [
  {
    lotId: "lot-a1",
    farmId: "farm-santa-maria",
    name: "Lote A1",
    ixorigueId: "IX-2044-A1",
    geometry: {
      type: "Polygon",
      coordinates: [[[-60.655, -31.623], [-60.651, -31.623], [-60.651, -31.619], [-60.655, -31.619], [-60.655, -31.623]]],
    },
  },
  {
    lotId: "lot-a2",
    farmId: "farm-santa-maria",
    name: "Lote A2",
    ixorigueId: "IX-2044-A2",
    geometry: {
      type: "Polygon",
      coordinates: [[[-60.65, -31.623], [-60.646, -31.623], [-60.646, -31.619], [-60.65, -31.619], [-60.65, -31.623]]],
    },
  },
  {
    lotId: "lot-p1",
    farmId: "farm-la-pradera",
    name: "Lote P1",
    ixorigueId: "IX-1911-P1",
    geometry: {
      type: "Polygon",
      coordinates: [[[-60.658, -31.629], [-60.652, -31.629], [-60.652, -31.624], [-60.658, -31.624], [-60.658, -31.629]]],
    },
  },
  {
    lotId: "lot-p2",
    farmId: "farm-la-pradera",
    name: "Lote P2",
    ixorigueId: "IX-1911-P2",
    geometry: {
      type: "Polygon",
      coordinates: [[[-60.651, -31.629], [-60.646, -31.629], [-60.646, -31.624], [-60.651, -31.624], [-60.651, -31.629]]],
    },
  },
];

const files: LotFile[] = [
  {
    importId: "imp-0001",
    lotId: "lot-a1",
    filename: "siembra_trigo_2026.csv",
    createdAt: new Date("2026-02-03T11:00:00.000Z"),
    assignedBy: "Camila Suarez",
    status: "processed",
  },
  {
    importId: "imp-0002",
    lotId: "lot-a1",
    filename: "fertilizacion_febrero.xlsx",
    createdAt: new Date("2026-02-12T15:45:00.000Z"),
    assignedBy: "Martin Rossi",
    status: "pending",
  },
  {
    importId: "imp-0003",
    lotId: "lot-a2",
    filename: "imagenes_dron_lote_a2.zip",
    createdAt: new Date("2026-01-29T09:30:00.000Z"),
    assignedBy: "Camila Suarez",
    status: "processed",
  },
  {
    importId: "imp-0004",
    lotId: "lot-p1",
    filename: "analisis_suelo_lote_p1.pdf",
    createdAt: new Date("2026-02-01T08:20:00.000Z"),
    assignedBy: "Sofia Medina",
    status: "processed",
  },
  {
    importId: "imp-0005",
    lotId: "lot-p2",
    filename: "mapa_rendimiento_p2.geojson",
    createdAt: new Date("2026-02-18T17:15:00.000Z"),
    assignedBy: "Nicolas Vega",
    status: "pending",
  },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getFarms(): Promise<Farm[]> {
  await wait(120);
  return farms;
}

export async function getLotsByFarm(farmId: string): Promise<Lot[]> {
  await wait(140);
  return lots.filter((lot) => lot.farmId === farmId);
}

export async function getFilesByLot(lotId: string): Promise<LotFile[]> {
  await wait(120);
  return files
    .filter((file) => file.lotId === lotId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
