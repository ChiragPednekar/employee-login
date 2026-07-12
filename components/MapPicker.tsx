"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui";

// Leaflet touches `window` at import time — client-only
const MapPicker = dynamic(() => import("./MapPickerInner"), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full" />,
});

export default MapPicker;
