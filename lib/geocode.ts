/**
 * Address lookup via Nominatim, OpenStreetMap's own geocoder. No API key and no
 * billing account — the free counterpart to Google's Geocoding API.
 *
 * Nominatim's usage policy caps this at one request per second and asks that
 * apps identify themselves. Browsers send a Referer automatically, and the UI
 * only searches on an explicit submit (never as-you-type), so the remaining
 * obligation is the rate limit, enforced below.
 * https://operations.osmfoundation.org/policies/nominatim/
 */

export type GeocodeHit = {
  lat: number;
  lng: number;
  label: string;
};

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL_MS = 1100;

let lastCallAt = 0;

export class GeocodeRateLimit extends Error {
  constructor(public readonly waitMs: number) {
    super("Please wait a moment before searching again.");
    this.name = "GeocodeRateLimit";
  }
}

/** Best match for a free-text address, or null when nothing matches. */
export async function geocodeAddress(query: string): Promise<GeocodeHit | null> {
  const q = query.trim();
  if (!q) return null;

  const since = Date.now() - lastCallAt;
  if (since < MIN_INTERVAL_MS) throw new GeocodeRateLimit(MIN_INTERVAL_MS - since);
  lastCallAt = Date.now();

  const url =
    `${ENDPOINT}?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&addressdetails=0`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Address search is unavailable right now.");

  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const hit = rows[0];
  if (!hit) return null;

  return {
    lat: Number(Number(hit.lat).toFixed(6)),
    lng: Number(Number(hit.lon).toFixed(6)),
    label: hit.display_name,
  };
}
