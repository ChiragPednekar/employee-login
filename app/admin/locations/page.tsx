"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getPosition, geoErrorMessage } from "@/lib/hooks";
import type { WorkLocation } from "@/lib/types";
import MapPicker from "@/components/MapPicker";
import { Card, FieldLabel, inputCls, EmptyState } from "@/components/ui";
import { Building2, LocateFixed, Plus, X, MapPin } from "lucide-react";

const emptyForm = { id: "", name: "", lat: "", lng: "", radius_m: "200" };
// Default map view when adding a fresh location (Mumbai)
const DEFAULT_CENTER = { lat: 19.076, lng: 72.8777 };

export default function LocationsPage() {
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabaseBrowser().from("locations").select("*").order("name");
    setLocations(data ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function useMyLocation() {
    setError(null);
    try {
      const pos = await getPosition();
      setForm((f) => ({
        ...f,
        lat: pos.coords.latitude.toFixed(6),
        lng: pos.coords.longitude.toFixed(6),
      }));
    } catch (e) {
      setError(geoErrorMessage(e));
    }
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (form.name.trim().length < 2) errs.name = "Give this location a name";
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    if (form.lat === "" || isNaN(lat) || lat < -90 || lat > 90)
      errs.coords = "Pick a point on the map or enter a valid latitude (−90 to 90)";
    else if (form.lng === "" || isNaN(lng) || lng < -180 || lng > 180)
      errs.coords = "Enter a valid longitude (−180 to 180)";
    const r = Number(form.radius_m);
    if (isNaN(r) || r < 20 || r > 5000) errs.radius = "Radius must be between 20 and 5000 meters";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      lat: Number(form.lat),
      lng: Number(form.lng),
      radius_m: Math.round(Number(form.radius_m)),
    };
    const supabase = supabaseBrowser();
    const { error } = form.id
      ? await supabase.from("locations").update(payload).eq("id", form.id)
      : await supabase.from("locations").insert(payload);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm(emptyForm);
    setFormErrors({});
    setShowForm(false);
    refresh();
  }

  async function toggleActive(loc: WorkLocation) {
    await supabaseBrowser().from("locations").update({ active: !loc.active }).eq("id", loc.id);
    refresh();
  }

  const mapLat = form.lat !== "" && !isNaN(Number(form.lat)) ? Number(form.lat) : DEFAULT_CENTER.lat;
  const mapLng = form.lng !== "" && !isNaN(Number(form.lng)) ? Number(form.lng) : DEFAULT_CENTER.lng;

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Approved locations</h1>
        <button
          onClick={() => {
            setForm(emptyForm);
            setFormErrors({});
            setShowForm(!showForm);
          }}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          {showForm ? <X size={15} /> : <Plus size={15} />}
          {showForm ? "Close" : "Add location"}
        </button>
      </div>

      {showForm && (
        <Card className="p-5">
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1">
              <FieldLabel>Location name</FieldLabel>
              <input
                required
                placeholder="e.g. Head Office"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputCls}
              />
              {formErrors.name && <p className="text-xs text-danger">{formErrors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <FieldLabel>Geofence — tap the map or drag the pin</FieldLabel>
                <button
                  type="button"
                  onClick={useMyLocation}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-primary-tint bg-surface-low px-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-tint/50"
                >
                  <LocateFixed size={13} />
                  Use my location
                </button>
              </div>
              <div className="overflow-hidden rounded-xl border border-line">
                <MapPicker
                  lat={mapLat}
                  lng={mapLng}
                  radiusM={Math.max(20, Number(form.radius_m) || 200)}
                  onPick={(lat, lng) =>
                    setForm((f) => ({ ...f, lat: String(lat), lng: String(lng) }))
                  }
                />
              </div>
              {formErrors.coords && <p className="text-xs text-danger">{formErrors.coords}</p>}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <FieldLabel>Latitude</FieldLabel>
                <input
                  required
                  type="number"
                  step="any"
                  placeholder="19.0760"
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Longitude</FieldLabel>
                <input
                  required
                  type="number"
                  step="any"
                  placeholder="72.8777"
                  value={form.lng}
                  onChange={(e) => setForm({ ...form, lng: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Radius (m)</FieldLabel>
                <input
                  type="number"
                  min={20}
                  max={5000}
                  value={form.radius_m}
                  onChange={(e) => setForm({ ...form, radius_m: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
            {formErrors.radius && <p className="text-xs text-danger">{formErrors.radius}</p>}

            {error && (
              <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">{error}</p>
            )}
            <button
              disabled={busy}
              className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {busy ? "Saving…" : form.id ? "Update location" : "Add location"}
            </button>
          </form>
        </Card>
      )}

      {locations.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No locations yet"
          hint="Add your office and regular work sites."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {locations.map((loc) => (
              <div
                key={loc.id}
                className={`flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50 ${
                  !loc.active ? "opacity-60" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
                    <MapPin size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{loc.name}</p>
                    <a
                      href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[13px] text-primary hover:underline"
                    >
                      {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                    </a>
                    <p className="text-xs text-outline">Radius {loc.radius_m}m</p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => {
                      setForm({
                        id: loc.id,
                        name: loc.name,
                        lat: String(loc.lat),
                        lng: String(loc.lng),
                        radius_m: String(loc.radius_m),
                      });
                      setFormErrors({});
                      setShowForm(true);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="h-8 rounded-lg bg-slate-100 px-2.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-slate-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActive(loc)}
                    className={`h-8 rounded-lg px-2.5 text-xs font-semibold ${
                      loc.active
                        ? "bg-slate-100 text-ink-muted hover:bg-slate-200"
                        : "bg-success-chip text-success-deep"
                    }`}
                  >
                    {loc.active ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </main>
  );
}
