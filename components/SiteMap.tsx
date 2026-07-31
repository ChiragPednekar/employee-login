"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, MAP_BLUE, MAP_BLUE_LIGHT, MAP_STYLE_TIDY } from "@/lib/googleMaps";
import type { WorkLocation } from "@/lib/types";

export type SiteMapPoint = Pick<WorkLocation, "id" | "name" | "lat" | "lng" | "radius_m">;

/**
 * Read-only Google map of the sites an employee may check in from, with each
 * geofence drawn to scale and an optional "you are here" dot.
 */
export default function SiteMap({
  sites,
  me,
  height = 260,
}: {
  sites: SiteMapPoint[];
  me?: { lat: number; lng: number } | null;
  height?: number;
}) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const drawnRef = useRef<(google.maps.Marker | google.maps.Circle)[]>([]);
  const meRef = useRef<google.maps.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !divRef.current) return;
        mapRef.current = new maps.Map(divRef.current, {
          center: sites[0] ? { lat: sites[0].lat, lng: sites[0].lng } : { lat: 19.076, lng: 72.8777 },
          zoom: 15,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          styles: MAP_STYLE_TIDY,
        });
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Google Maps failed to load");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw sites whenever the allowed set changes
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google?.maps) return;
    const maps = window.google.maps;

    for (const o of drawnRef.current) o.setMap(null);
    drawnRef.current = [];

    const bounds = new maps.LatLngBounds();
    for (const s of sites) {
      const center = { lat: s.lat, lng: s.lng };
      const marker = new maps.Marker({ position: center, map, title: s.name });
      const circle = new maps.Circle({
        map,
        center,
        radius: s.radius_m,
        strokeColor: MAP_BLUE,
        strokeOpacity: 0.9,
        strokeWeight: 1.5,
        fillColor: MAP_BLUE_LIGHT,
        fillOpacity: 0.12,
      });
      drawnRef.current.push(marker, circle);
      const b = circle.getBounds();
      if (b) bounds.union(b);
    }
    if (me) bounds.extend(me);

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 32);
    }
  }, [ready, sites, me]);

  // "You are here" dot
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google?.maps) return;
    const maps = window.google.maps;
    meRef.current?.setMap(null);
    meRef.current = null;
    if (!me) return;
    meRef.current = new maps.Marker({
      position: me,
      map,
      title: "Your current location",
      icon: {
        path: maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: "#0f9d58",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2.5,
      },
      zIndex: 999,
    });
  }, [ready, me]);

  if (error) {
    return (
      <div
        className="flex items-center justify-center bg-surface-low px-6 text-center text-xs text-ink-muted"
        style={{ height }}
      >
        {error}
      </div>
    );
  }

  return <div ref={divRef} style={{ height, width: "100%" }} />;
}
