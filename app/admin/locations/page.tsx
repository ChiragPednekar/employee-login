"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getPosition, geoErrorMessage } from "@/lib/hooks";
import type { WorkLocation } from "@/lib/types";

const emptyForm = { id: "", name: "", lat: "", lng: "", radius_m: "200" };

export default function LocationsPage() {
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      lat: Number(form.lat),
      lng: Number(form.lng),
      radius_m: Math.max(20, Number(form.radius_m) || 200),
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
    setShowForm(false);
    refresh();
  }

  async function toggleActive(loc: WorkLocation) {
    await supabaseBrowser().from("locations").update({ active: !loc.active }).eq("id", loc.id);
    refresh();
  }

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Approved locations</h1>
        <button
          onClick={() => {
            setForm(emptyForm);
            setShowForm(!showForm);
          }}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          {showForm ? "Close" : "+ Add location"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-white p-5">
          <input
            required
            placeholder="Location name (e.g. Head Office)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              type="number"
              step="any"
              placeholder="Latitude"
              value={form.lat}
              onChange={(e) => setForm({ ...form, lat: e.target.value })}
              className="rounded-lg border border-line-strong px-3 py-2 text-sm"
            />
            <input
              required
              type="number"
              step="any"
              placeholder="Longitude"
              value={form.lng}
              onChange={(e) => setForm({ ...form, lng: e.target.value })}
              className="rounded-lg border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={useMyLocation}
            className="w-full rounded-lg border border-primary-tint bg-surface-low py-2 text-sm font-semibold text-primary"
          >
            📍 Use my current location
          </button>
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Radius (meters)</label>
            <input
              type="number"
              min={20}
              value={form.radius_m}
              onChange={(e) => setForm({ ...form, radius_m: e.target.value })}
              className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          {error && <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">{error}</p>}
          <button
            disabled={busy}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {busy ? "Saving…" : form.id ? "Update location" : "Add location"}
          </button>
        </form>
      )}

      <div className="space-y-2">
        {locations.map((loc) => (
          <div
            key={loc.id}
            className={`rounded-xl border border-line bg-white p-4 ${!loc.active ? "opacity-50" : ""}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold">{loc.name}</p>
                <a
                  href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary"
                >
                  {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)} →
                </a>
                <p className="text-xs text-outline">Radius {loc.radius_m}m</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setForm({
                      id: loc.id,
                      name: loc.name,
                      lat: String(loc.lat),
                      lng: String(loc.lng),
                      radius_m: String(loc.radius_m),
                    });
                    setShowForm(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-ink-muted"
                >
                  Edit
                </button>
                <button
                  onClick={() => toggleActive(loc)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    loc.active ? "bg-slate-100 text-ink-muted" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {loc.active ? "Disable" : "Enable"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
