"use client";

import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import { useEffect, useState } from "react";
import { geocodeAddress, GeocodeRateLimit } from "@/lib/geocode";
import { Search, Loader2 } from "lucide-react";
import "leaflet/dist/leaflet.css";

const pin = divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#003ec7;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    },
  });
  return null;
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng]);
    // Leaflet mis-sizes when mounted inside a just-expanded container
    setTimeout(() => map.invalidateSize(), 100);
  }, [lat, lng, map]);
  return null;
}

export default function MapPickerInner({
  lat,
  lng,
  radiusM,
  onPick,
}: {
  lat: number;
  lng: number;
  radiusM: number;
  onPick: (lat: number, lng: number, address?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function search() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const hit = await geocodeAddress(query);
      if (!hit) {
        setSearchError("No match for that address. Try adding the city or a landmark.");
        return;
      }
      onPick(hit.lat, hit.lng, hit.label);
    } catch (err) {
      setSearchError(
        err instanceof GeocodeRateLimit
          ? err.message
          : "Address search is unavailable right now — you can still tap the map."
      );
    } finally {
      setSearching(false);
    }
  }

  return (
    <div>
      {/* Deliberately not a <form>: this picker renders inside the location
          form, and a nested form makes Enter/"Find" submit the outer one. */}
      <div className="flex gap-2 border-b border-line bg-white p-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                search();
              }
            }}
            aria-label="Search for an address"
            placeholder="Search an address or landmark…"
            className="h-9 w-full rounded-lg border border-line-strong bg-white pl-9 pr-3 text-sm text-ink outline-none placeholder:text-outline focus:border-primary"
          />
        </div>
        <button
          type="button"
          onClick={search}
          disabled={searching}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Find
        </button>
      </div>
      {searchError && (
        <p className="border-b border-line bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {searchError}
        </p>
      )}
      <MapContainer
      center={[lat, lng]}
      zoom={15}
      style={{ height: 260, width: "100%", borderRadius: 12, zIndex: 0 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onPick={onPick} />
      <Recenter lat={lat} lng={lng} />
      <Marker
        position={[lat, lng]}
        icon={pin}
        draggable
        eventHandlers={{
          dragend: (e) => {
            const p = (e.target as L.Marker).getLatLng();
            onPick(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
          },
        }}
      />
      <Circle
        center={[lat, lng]}
        radius={radiusM}
        pathOptions={{ color: "#003ec7", fillColor: "#0052ff", fillOpacity: 0.12, weight: 1.5 }}
      />
      </MapContainer>
      <p className="border-t border-line bg-surface-low px-3 py-1.5 text-[11px] text-ink-muted">
        Tap the map or drag the pin to set the exact centre. The shaded circle is the area
        employees may check in from. Map data © OpenStreetMap contributors.
      </p>
    </div>
  );
}
