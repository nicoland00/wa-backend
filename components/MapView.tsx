"use client";

import { useEffect, useRef, useState } from "react";
import type { Lot } from "@/lib/api";

const GOOGLE_MAPS_API_KEY = "AIzaSyAACgbSOwM94Kb47OYz3NPKaYvhC8_M348";

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

type GoogleMapsWindow = Window & {
  google?: {
    maps: {
      Map: new (el: HTMLElement, opts: object) => GoogleMap;
      Polygon: new (opts: object) => GooglePolygon;
      Marker: new (opts: object) => GoogleMarker;
      InfoWindow: new (opts: object) => GoogleInfoWindow;
      LatLngBounds: new () => GoogleBounds;
      event: { addListener: (target: object, event: string, fn: () => void) => void };
    };
  };
};

type GoogleMap = {
  fitBounds: (bounds: GoogleBounds) => void;
  setCenter: (latLng: { lat: number; lng: number }) => void;
};
type GooglePolygon = {
  setMap: (map: GoogleMap | null) => void;
  addListener: (event: string, fn: (e: { latLng: unknown }) => void) => void;
  setOptions: (opts: object) => void;
};
type GoogleMarker = {
  setMap: (map: GoogleMap | null) => void;
  addListener: (event: string, fn: () => void) => void;
};
type GoogleInfoWindow = {
  open: (map: GoogleMap, marker: GoogleMarker) => void;
  close: () => void;
  setContent: (content: string) => void;
};
type GoogleBounds = {
  extend: (latLng: { lat: number; lng: number }) => void;
  isEmpty: () => boolean;
};

let googleMapsPromise: Promise<void> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (googleMapsPromise) return googleMapsPromise;
  const win = window as GoogleMapsWindow;
  if (win.google?.maps) return Promise.resolve();
  googleMapsPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=weekly`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

export default function MapView({ lots, animals = [], selectedLotId, onSelectLot }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const polygonsRef = useRef<{ lotId: string; polygon: GooglePolygon }[]>([]);
  const markersRef = useRef<GoogleMarker[]>([]);
  const infoWindowRef = useRef<GoogleInfoWindow | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    loadGoogleMaps().then(() => setMapReady(true)).catch(console.error);
  }, []);

  useEffect(() => {
    if (!mapReady || !containerRef.current) return;
    const win = window as GoogleMapsWindow;
    const gmaps = win.google?.maps;
    if (!gmaps) return;

    const map = new gmaps.Map(containerRef.current, {
      center: { lat: -31.623, lng: -60.651 },
      zoom: 13,
      mapTypeId: "satellite",
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });

    mapRef.current = map;
    infoWindowRef.current = new gmaps.InfoWindow({});

    return () => {
      mapRef.current = null;
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const win = window as GoogleMapsWindow;
    const gmaps = win.google?.maps;
    if (!map || !gmaps) return;

    for (const { polygon } of polygonsRef.current) polygon.setMap(null);
    polygonsRef.current = [];

    const bounds = new gmaps.LatLngBounds();

    for (const lot of lots) {
      if (!lot.geometry) continue;
      const paths = lot.geometry.coordinates[0].map(([lng, lat]: number[]) => ({ lat, lng }));
      for (const pt of paths) bounds.extend(pt);

      const isSelected = lot.lotId === selectedLotId;
      const polygon = new gmaps.Polygon({
        paths,
        strokeColor: isSelected ? "#57A28B" : "#1f2937",
        strokeWeight: isSelected ? 2.5 : 1.5,
        fillColor: isSelected ? "#57A28B" : "#86b7ff",
        fillOpacity: isSelected ? 0.3 : 0.2,
        map,
      });

      polygon.addListener("click", () => onSelectLot(lot.lotId));
      polygonsRef.current.push({ lotId: lot.lotId, polygon });
    }

    if (!bounds.isEmpty()) map.fitBounds(bounds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, lots, selectedLotId]);

  useEffect(() => {
    const map = mapRef.current;
    const win = window as GoogleMapsWindow;
    const gmaps = win.google?.maps;
    if (!map || !gmaps) return;

    for (const marker of markersRef.current) marker.setMap(null);
    markersRef.current = [];

    const visibleAnimals = selectedLotId ? animals.filter((a) => a.lotId === selectedLotId) : animals;

    for (const animal of visibleAnimals) {
      const marker = new gmaps.Marker({
        position: animal.coordinates,
        map,
        title: animal.earTagNumber,
        icon: {
          path: "M 0,-8 C -5,-8 -8,-5 -8,0 C -8,5 0,12 0,12 C 0,12 8,5 8,0 C 8,-5 5,-8 0,-8 Z",
          fillColor: selectedLotId ? "#f97316" : "#57A28B",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 1.5,
          scale: 1,
        },
      });

      marker.addListener("click", () => {
        if (!infoWindowRef.current) return;
        infoWindowRef.current.setContent(`
          <div style="font-family:Poppins,sans-serif;padding:4px 2px;min-width:140px">
            <p style="font-weight:600;margin:0 0 4px">${animal.earTagNumber}</p>
            <p style="margin:0;color:#64748b;font-size:12px">Lot: ${animal.lotName ?? "—"}</p>
            <p style="margin:0;color:#64748b;font-size:12px">Breed: ${animal.breed ?? "—"}</p>
            <p style="margin:0;color:#64748b;font-size:12px">Weight: ${animal.currentWeight != null ? `${animal.currentWeight} kg` : "—"}</p>
          </div>
        `);
        infoWindowRef.current.open(map, marker);
      });

      markersRef.current.push(marker);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, animals, selectedLotId]);

  const visibleCount = selectedLotId ? animals.filter((a) => a.lotId === selectedLotId).length : animals.length;

  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-2xl shadow-sm">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-4 top-4 rounded-xl bg-white/90 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm backdrop-blur-sm">
        {selectedLotId ? `${visibleCount} animals in lot` : `${visibleCount} animals`}
      </div>
    </div>
  );
}
