"use client";

/** Google Maps JS API key. Blank when unset — callers fall back to OpenStreetMap. */
export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export const hasGoogleMaps = () => GOOGLE_MAPS_KEY.length > 0;

const SCRIPT_ID = "google-maps-js";

let loader: Promise<typeof google.maps> | null = null;

/**
 * Google rejects a bad key *after* the script loads, so the script's own
 * onload/onerror can't catch it — the map just renders as a dark "can't load
 * Google Maps" panel. Google calls window.gm_authFailure in that case, which is
 * the only reliable signal. Record it so the picker can drop back to
 * OpenStreetMap instead of leaving the admin staring at a broken map.
 */
declare global {
  interface Window {
    /** Called by the Maps JS API when it refuses the key. */
    gm_authFailure?: () => void;
  }
}

let authFailed = false;
const authListeners = new Set<() => void>();

export const googleMapsAuthFailed = () => authFailed;

export function onGoogleMapsAuthFailure(cb: () => void): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

if (typeof window !== "undefined") {
  window.gm_authFailure = () => {
    authFailed = true;
    loader = null;
    authListeners.forEach((cb) => cb());
  };
}

/** Load the Maps JS API once per page and resolve with the `google.maps` namespace. */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (!hasGoogleMaps()) {
    return Promise.reject(new Error("No Google Maps API key configured"));
  }
  if (authFailed) {
    return Promise.reject(new Error("Google rejected this API key"));
  }
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Google Maps can only load in the browser"));
      return;
    }
    if (window.google?.maps) {
      resolve(window.google.maps);
      return;
    }

    const done = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps failed to initialise"));
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", () => reject(new Error("Google Maps failed to load")));
      return;
    }

    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.async = true;
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}` +
      `&loading=async&v=quarterly`;
    s.addEventListener("load", done);
    s.addEventListener("error", () =>
      reject(new Error("Google Maps failed to load — check the API key and its referrer restrictions"))
    );
    document.head.appendChild(s);
  });

  // A failed load shouldn't poison every later attempt (e.g. transient network).
  loader.catch(() => {
    loader = null;
  });

  return loader;
}

/** WorkLog blue, reused for markers and geofence circles. */
export const MAP_BLUE = "#003ec7";
export const MAP_BLUE_LIGHT = "#0052ff";

export const MAP_STYLE_TIDY: google.maps.MapTypeStyle[] = [
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
];
