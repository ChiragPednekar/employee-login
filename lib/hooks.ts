"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Employee } from "@/lib/types";

export function useMe() {
  const [me, setMe] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("employees")
        .select("*")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      setMe(data);
      setLoading(false);
    });
  }, []);
  return { me, loading };
}

export function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Location is not supported on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    });
  });
}

export function geoErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as GeolocationPositionError;
    if (e.code === 1)
      return "Location permission denied. Please allow location access for this app in your phone settings and try again.";
    if (e.code === 2)
      return "Location services are unavailable. Turn on GPS / location services and try again.";
    if (e.code === 3) return "Location request timed out. Move to an open area and try again.";
  }
  return err instanceof Error ? err.message : "Could not get your location";
}

/** Max GPS accuracy (metres) we'll trust for a geofence decision. */
export const ACCURACY_LIMIT_M = 150;

/** Turn any check-in/out error (incl. the server GEOFENCE_BLOCK signal) into a clear message. */
export function attendanceErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = msg.match(/GEOFENCE_BLOCK\|(\d+)\|(\d+)/);
  if (m) {
    return `You are outside the permitted office location. You must be within ${m[2]} meters of your assigned office to mark attendance. (You appear to be about ${m[1]} m away.)`;
  }
  if (msg.includes("assigned office is inactive"))
    return "Your assigned office is currently inactive. Please contact your admin.";
  return geoErrorMessage(err);
}

/** Haversine distance in metres — client-side mirror of the server calc. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.asin(Math.sqrt(a));
}

// Fire-and-forget: ask the push processor to drain the queue right now
export function nudgePushProcessor() {
  supabaseBrowser().functions.invoke("process-notifications", { body: {} }).catch(() => {});
}
