"use client";

import { useEffect, useState } from "react";
import { ImminentClassBanner } from "./ImminentClassBanner";

const POLL_MS = 30_000;

type Imminent = {
  id: string;
  title: string;
  scheduled_at: string;
  duration_minutes: number;
};

export function ImminentClassBannerLoader() {
  const [data, setData] = useState<Imminent | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/me/imminent-class")
        .then((r) => r.json())
        .then((d: { imminent: Imminent | null }) => {
          if (alive) setData(d.imminent);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!data) return null;

  return (
    <ImminentClassBanner
      classId={data.id}
      title={data.title}
      scheduledAt={data.scheduled_at}
      durationMinutes={data.duration_minutes}
    />
  );
}
