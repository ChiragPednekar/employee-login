"use client";

import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";

const pin = divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#003ec7;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    },
  });
  return null;
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng]);
    // Leaflet mis-sizes when mounted inside a just-expanded container
    setTimeout(() => map.invalidateSize(), 100);
  }, [lat, lng, map]);
  return null;
}

export default function MapPickerInner({
  lat,
  lng,
  radiusM,
  onPick,
}: {
  lat: number;
  lng: number;
  radiusM: number;
  onPick: (lat: number, lng: number) => void;
}) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      style={{ height: 260, width: "100%", borderRadius: 12, zIndex: 0 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onPick={onPick} />
      <Recenter lat={lat} lng={lng} />
      <Marker
        position={[lat, lng]}
        icon={pin}
        draggable
        eventHandlers={{
          dragend: (e) => {
            const p = (e.target as L.Marker).getLatLng();
            onPick(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
          },
        }}
      />
      <Circle
        center={[lat, lng]}
        radius={radiusM}
        pathOptions={{ color: "#003ec7", fillColor: "#0052ff", fillOpacity: 0.12, weight: 1.5 }}
      />
    </MapContainer>
  );
}
