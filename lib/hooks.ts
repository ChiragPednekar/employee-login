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
    if (e.code === 2) return "Could not determine your location. Move to an open area and try again.";
    if (e.code === 3) return "Location request timed out. Try again.";
  }
  return err instanceof Error ? err.message : "Could not get your location";
}

// Fire-and-forget: ask the push processor to drain the queue right now
export function nudgePushProcessor() {
  supabaseBrowser().functions.invoke("process-notifications", { body: {} }).catch(() => {});
}
