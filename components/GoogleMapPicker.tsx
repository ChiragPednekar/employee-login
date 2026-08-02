"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, MAP_BLUE, MAP_BLUE_LIGHT, MAP_STYLE_TIDY } from "@/lib/googleMaps";
import { Search, Loader2 } from "lucide-react";

/**
 * Interactive Google Maps geofence picker: search an address, click the map or
 * drag the pin. The circle previews the radius the employee must stand inside.
 */
export default function GoogleMapPicker({
  lat,
  lng,
  radiusM,
  onPick,
  height = 300,
}: {
  lat: number;
  lng: number;
  radiusM: number;
  onPick: (lat: number, lng: number, address?: string) => void;
  height?: number;
}) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  // Latest onPick without forcing the map to re-initialise on every render.
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ---- Initialise the map once ----
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !divRef.current) return;
        const center = { lat, lng };
        const map = new maps.Map(divRef.current, {
          center,
          zoom: 16,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          styles: MAP_STYLE_TIDY,
        });
        const marker = new maps.Marker({
          position: center,
          map,
          draggable: true,
          title: "Drag to move the geofence centre",
        });
        const circle = new maps.Circle({
          map,
          center,
          radius: radiusM,
          strokeColor: MAP_BLUE,
          strokeOpacity: 0.9,
          strokeWeight: 1.5,
          fillColor: MAP_BLUE_LIGHT,
          fillOpacity: 0.12,
        });

        const emit = (p: google.maps.LatLng) =>
          pickRef.current(Number(p.lat().toFixed(6)), Number(p.lng().toFixed(6)));

        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) emit(e.latLng);
        });
        marker.addListener("dragend", () => {
          const p = marker.getPosition();
          if (p) emit(p);
        });
        // Clicking the circle should move the pin too, not swallow the click.
        circle.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) emit(e.latLng);
        });

        mapRef.current = map;
        markerRef.current = marker;
        circleRef.current = circle;
        geocoderRef.current = new maps.Geocoder();
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Google Maps failed to load");
      });
    return () => {
      cancelled = true;
    };
    // Deliberately mount-only: later lat/lng/radius changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Keep pin, circle and viewport in sync with the form ----
  useEffect(() => {
    if (!ready) return;
    const pos = { lat, lng };
    markerRef.current?.setPosition(pos);
    circleRef.current?.setCenter(pos);
    mapRef.current?.panTo(pos);
  }, [ready, lat, lng]);

  useEffect(() => {
    if (!ready) return;
    circleRef.current?.setRadius(radiusM);
  }, [ready, radiusM]);

  async function search() {
    const q = query.trim();
    if (!q || searching || !geocoderRef.current) return;
    setSearching(true);
    setSearchError(null);
    try {
      const { results } = await geocoderRef.current.geocode({ address: q });
      const hit = results[0];
      if (!hit) {
        setSearchError("No match for that address. Try adding the city or a landmark.");
        return;
      }
      const p = hit.geometry.location;
      pickRef.current(
        Number(p.lat().toFixed(6)),
        Number(p.lng().toFixed(6)),
        hit.formatted_address
      );
      mapRef.current?.setZoom(17);
    } catch {
      setSearchError(
        "Address search is unavailable. Enable the Geocoding API for this key, or just tap the map."
      );
    } finally {
      setSearching(false);
    }
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 bg-surface-low px-6 text-center"
        style={{ height }}
      >
        <p className="text-sm font-semibold text-ink">Map unavailable</p>
        <p className="text-xs text-ink-muted">{error}</p>
      </div>
    );
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
          disabled={searching || !ready}
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
      <div ref={divRef} style={{ height, width: "100%" }} />
      <p className="border-t border-line bg-surface-low px-3 py-1.5 text-[11px] text-ink-muted">
        Tap the map or drag the pin to set the exact centre. The shaded circle is the
        area employees may check in from.
      </p>
    </div>
  );
}
