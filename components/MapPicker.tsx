"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui";
import { hasGoogleMaps } from "@/lib/googleMaps";

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
 */
export default function MapPicker(props: {
  lat: number;
  lng: number;
  radiusM: number;
  onPick: (lat: number, lng: number, address?: string) => void;
}) {
  return hasGoogleMaps() ? <GooglePicker {...props} /> : <LeafletPicker {...props} />;
}
