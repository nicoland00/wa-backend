"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Lot } from "@/lib/api";

type AnimalPoint = {
  animalId: string;
  lotId: string;
  earTagNumber: string;
  lotName?: string;
  breed?: string;
  sex?: string;
  currentWeight?: number;
  coordinates: { lat: number; lng: number };
};

type MapViewProps = {
  lots: Lot[];
  animals?: AnimalPoint[];
  selectedLotId: string | null;
  onSelectLot: (lotId: string) => void;
};

type LotFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: { lotId: string; name: string; ixorigueId: string };
    geometry: Lot["geometry"];
  }>;
};

type AnimalFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: { animalId: string; lotId: string; earTagNumber: string };
    geometry: { type: "Point"; coordinates: [number, number] };
  }>;
};

type GeoJSONSource<T> = {
  setData: (data: T) => void;
};

type LngLatBoundsLike = {
  extend: (coordinate: [number, number]) => LngLatBoundsLike;
};

type NavigationControlOptions = {
  showCompass: boolean;
};

type MapLoadEvent = {
  features?: Array<{
    properties?: {
      lotId?: string;
      animalId?: string;
      earTagNumber?: string;
      lotName?: string;
      breed?: string;
      sex?: string;
      currentWeight?: string | number;
    };
  }>;
};

type MapInstance = {
  addControl: (control: unknown, position: "top-right") => void;
  addSource: <T>(sourceId: string, source: { type: "geojson"; data: T }) => void;
  addLayer: (layer: Record<string, unknown>) => void;
  on: (event: "load" | "click" | "mouseenter" | "mouseleave", layerIdOrHandler: string | (() => void), handler?: (event: MapLoadEvent) => void) => void;
  once: (event: "load", handler: () => void) => void;
  getCanvas: () => { style: { cursor: string } };
  getSource: <T>(sourceId: string) => GeoJSONSource<T> | undefined;
  fitBounds: (bounds: LngLatBoundsLike, options: { padding: number; maxZoom: number; duration: number }) => void;
  setFeatureState: (target: { source: string; id: string }, state: { selected: boolean }) => void;
  isStyleLoaded: () => boolean;
  remove: () => void;
};

type MapboxGLRuntime = {
  accessToken: string;
  Map: new (options: {
    container: HTMLDivElement;
    style: string;
    center: [number, number];
    zoom: number;
  }) => MapInstance;
  NavigationControl: new (options: NavigationControlOptions) => unknown;
  LngLatBounds: new (sw: [number, number], ne: [number, number]) => LngLatBoundsLike;
};

declare global {
  interface Window {
    mapboxgl?: MapboxGLRuntime;
  }
}

const LOT_SOURCE_ID = "lots-source";
const LOT_FILL_LAYER_ID = "lots-fill";
const LOT_LINE_LAYER_ID = "lots-line";
const ANIMAL_SOURCE_ID = "animals-source";
const ANIMAL_LAYER_ID = "animals-circle";

function getMapboxRuntime(): MapboxGLRuntime | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.mapboxgl ?? null;
}

export default function MapView({ lots, animals = [], selectedLotId, onSelectLot }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [mapboxReady, setMapboxReady] = useState<boolean>(() => Boolean(getMapboxRuntime()));
  const [hoveredAnimal, setHoveredAnimal] = useState<{
    animalId: string;
    earTagNumber: string;
    lotName: string | null;
    breed: string | null;
    sex: string | null;
    currentWeight: number | null;
  } | null>(null);

  const mapToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const lotFeatureCollection = useMemo<LotFeatureCollection>(() => ({
    type: "FeatureCollection",
    features: lots.map((lot) => ({
      type: "Feature",
      id: lot.lotId,
      properties: {
        lotId: lot.lotId,
        name: lot.name,
        ixorigueId: lot.ixorigueId,
      },
      geometry: lot.geometry,
    })),
  }), [lots]);

  const visibleAnimals = useMemo(
    () => (selectedLotId ? animals.filter((animal) => animal.lotId === selectedLotId) : animals),
    [animals, selectedLotId],
  );

  const animalFeatureCollection = useMemo<AnimalFeatureCollection>(() => ({
    type: "FeatureCollection",
    features: visibleAnimals.map((animal) => ({
      type: "Feature",
      id: animal.animalId,
      properties: {
        animalId: animal.animalId,
        lotId: animal.lotId,
        earTagNumber: animal.earTagNumber,
        lotName: animal.lotName ?? "",
        breed: animal.breed ?? "",
        sex: animal.sex ?? "",
        currentWeight: animal.currentWeight ?? "",
      },
      geometry: {
        type: "Point",
        coordinates: [animal.coordinates.lng, animal.coordinates.lat],
      },
    })),
  }), [visibleAnimals]);

  useEffect(() => {
    if (mapboxReady || typeof window === "undefined") {
      return;
    }

    const timer = window.setInterval(() => {
      if (window.mapboxgl) {
        setMapboxReady(true);
        window.clearInterval(timer);
      }
    }, 150);

    return () => window.clearInterval(timer);
  }, [mapboxReady]);

  useEffect(() => {
    const mapboxgl = getMapboxRuntime();
    if (!containerRef.current || !mapToken || !mapboxReady || mapRef.current || !mapboxgl) {
      return;
    }

    mapboxgl.accessToken = mapToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-v9",
      center: [-60.651, -31.623],
      zoom: 13,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource(LOT_SOURCE_ID, {
        type: "geojson",
        data: lotFeatureCollection,
      });

      map.addLayer({
        id: LOT_FILL_LAYER_ID,
        type: "fill",
        source: LOT_SOURCE_ID,
        paint: {
          "fill-color": ["case", ["boolean", ["feature-state", "selected"], false], "#1d4ed8", "#86b7ff"],
          "fill-opacity": 0.22,
        },
      });

      map.addLayer({
        id: LOT_LINE_LAYER_ID,
        type: "line",
        source: LOT_SOURCE_ID,
        paint: {
          "line-color": "#1f2937",
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 1],
        },
      });

      map.addSource(ANIMAL_SOURCE_ID, {
        type: "geojson",
        data: animalFeatureCollection,
      });

      map.addLayer({
        id: ANIMAL_LAYER_ID,
        type: "circle",
        source: ANIMAL_SOURCE_ID,
        paint: {
          "circle-radius": 6,
          "circle-color": selectedLotId ? "#f97316" : "#16a34a",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });
    });

    map.on("click", LOT_FILL_LAYER_ID, (event) => {
      const lotId = event.features?.[0]?.properties?.lotId;
      if (typeof lotId === "string") {
        onSelectLot(lotId);
      }
    });

    map.on("mouseenter", LOT_FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", LOT_FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("mouseenter", ANIMAL_LAYER_ID, (event) => {
      const feature = event.features?.[0]?.properties;
      if (!feature?.animalId || !feature.earTagNumber) {
        return;
      }

      const nextWeight = typeof feature.currentWeight === "number"
        ? feature.currentWeight
        : typeof feature.currentWeight === "string" && feature.currentWeight.trim()
          ? Number(feature.currentWeight)
          : null;

      map.getCanvas().style.cursor = "pointer";
      setHoveredAnimal({
        animalId: feature.animalId,
        earTagNumber: feature.earTagNumber,
        lotName: feature.lotName?.trim() || null,
        breed: feature.breed?.trim() || null,
        sex: feature.sex?.trim() || null,
        currentWeight: Number.isFinite(nextWeight) ? nextWeight : null,
      });
    });

    map.on("mouseleave", ANIMAL_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      setHoveredAnimal(null);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [animalFeatureCollection, lotFeatureCollection, mapToken, mapboxReady, onSelectLot, selectedLotId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const syncData = () => {
      const lotSource = map.getSource<LotFeatureCollection>(LOT_SOURCE_ID);
      if (lotSource) {
        lotSource.setData(lotFeatureCollection);
      }

      const animalSource = map.getSource<AnimalFeatureCollection>(ANIMAL_SOURCE_ID);
      if (animalSource) {
        animalSource.setData(animalFeatureCollection);
      }

      const pointCoordinates = animalFeatureCollection.features.map((feature) => feature.geometry.coordinates);
      const polygonCoordinates = lotFeatureCollection.features.flatMap((feature) => feature.geometry.coordinates[0] ?? []);
      const allCoordinates = pointCoordinates.length ? pointCoordinates : polygonCoordinates;

      if (!allCoordinates.length) {
        return;
      }

      const mapboxgl = getMapboxRuntime();
      if (!mapboxgl) {
        return;
      }

      const bounds = allCoordinates.reduce(
        (acc, coordinate) => acc.extend(coordinate as [number, number]),
        new mapboxgl.LngLatBounds(allCoordinates[0] as [number, number], allCoordinates[0] as [number, number]),
      );

      map.fitBounds(bounds, { padding: 64, maxZoom: pointCoordinates.length ? 15 : 14, duration: 500 });
    };

    if (!map.isStyleLoaded()) {
      map.once("load", syncData);
      return;
    }

    syncData();
  }, [animalFeatureCollection, lotFeatureCollection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const syncSelection = () => {
      if (selectedRef.current) {
        map.setFeatureState({ source: LOT_SOURCE_ID, id: selectedRef.current }, { selected: false });
      }

      if (selectedLotId) {
        map.setFeatureState({ source: LOT_SOURCE_ID, id: selectedLotId }, { selected: true });
        selectedRef.current = selectedLotId;
        return;
      }

      selectedRef.current = null;
    };

    if (!map.isStyleLoaded()) {
      map.once("load", syncSelection);
      return;
    }

    syncSelection();
  }, [selectedLotId]);

  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-2xl bg-slate-200 shadow-sm">
      <div ref={containerRef} className="h-full w-full" />
      {!mapToken ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/90 p-8 text-center text-sm text-slate-600">
          Configure `NEXT_PUBLIC_MAPBOX_TOKEN` para visualizar el mapa interactivo.
        </div>
      ) : null}
      <div className="absolute left-4 top-4 rounded-xl bg-white/90 px-3 py-2 text-xs text-slate-700 shadow">
        {selectedLotId ? `${visibleAnimals.length} animals in selected lot` : `${visibleAnimals.length} animals in ranch view`}
      </div>
      {hoveredAnimal ? (
        <div className="absolute bottom-4 left-4 max-w-[260px] rounded-2xl bg-white/95 px-4 py-3 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Animal hover</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{hoveredAnimal.earTagNumber}</p>
          <div className="mt-2 space-y-1 text-sm text-slate-600">
            <p>Lot: {hoveredAnimal.lotName ?? "Unknown"}</p>
            <p>Breed: {hoveredAnimal.breed ?? "-"}</p>
            <p>Sex: {hoveredAnimal.sex ?? "-"}</p>
            <p>Weight: {hoveredAnimal.currentWeight != null ? `${hoveredAnimal.currentWeight} kg` : "-"}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
