"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { hasGoogleMaps, googleMapsAuthFailed, onGoogleMapsAuthFailure } from "@/lib/googleMaps";

// Leaflet touches `window` at import time — client-only
const LeafletPicker = dynamic(() => import("./MapPickerInner"), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full" />,
});

const GooglePicker = dynamic(() => import("./GoogleMapPicker"), {
  ssr: false,
  loading: () => <Skeleton className="h-[300px] w-full" />,
});

/**
 * Geofence picker. Uses Google Maps when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set
 * (adds address search), otherwise falls back to the OpenStreetMap picker so the
 * page keeps working without a key.
 *
 * If Google rejects the key at runtime — wrong key, wrong referrer restriction,
 * billing disabled, quota exhausted — we fall back to OpenStreetMap too. Setting
 * a bad key should never cost the admin a working map.
 */
export default function MapPicker(props: {
  lat: number;
  lng: number;
  radiusM: number;
  onPick: (lat: number, lng: number, address?: string) => void;
}) {
  const [keyRejected, setKeyRejected] = useState(googleMapsAuthFailed);

  useEffect(() => onGoogleMapsAuthFailure(() => setKeyRejected(true)), []);

  return hasGoogleMaps() && !keyRejected ? (
    <GooglePicker {...props} />
  ) : (
    <LeafletPicker {...props} />
  );
}
