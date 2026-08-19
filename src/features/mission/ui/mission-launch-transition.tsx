"use client";

import { Globe2, MapPin, Navigation } from "lucide-react";
import { useRef } from "react";
import { gsap, useGSAP } from "./motion";

type MissionLaunchTransitionProps = {
  active: boolean;
  routeLabel?: string;
};

export function MissionLaunchTransition({ active, routeLabel }: MissionLaunchTransitionProps) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.timeline()
      .from(".launch-globe", { scale: 0.72, opacity: 0, rotate: -8, duration: 0.65, ease: "back.out(1.5)" })
      .from(".launch-pin", { scale: 0, opacity: 0, stagger: 0.14, duration: 0.3, ease: "back.out(2)" }, "-=0.25")
      .from(".launch-copy > *", { y: 12, opacity: 0, stagger: 0.08, duration: 0.35, ease: "power2.out" }, "-=0.2");
  }, { scope: root, dependencies: [active] });

  if (!active) return null;

  return (
    <div className="mission-launch" ref={root} role="status" aria-live="polite" aria-label="Начинаем решать задачу">
      <div className="launch-scene" aria-hidden="true">
        <div className="launch-globe">
          <Globe2 size={172} strokeWidth={0.75} />
          <span className="launch-origin launch-pin"><MapPin size={20} fill="currentColor" /></span>
          <span className="launch-destination launch-pin"><MapPin size={20} fill="currentColor" /></span>
        </div>
        <div className="launch-orbit"><span><Navigation size={21} fill="currentColor" /></span></div>
      </div>
      <div className="launch-copy">
        <span>Задача принята</span>
        <strong>Прокладываем лучший путь</strong>
        <small>{routeLabel ?? "Сверяем маршруты и ограничения"}</small>
      </div>
      <div className="launch-progress" aria-hidden="true"><i /></div>
    </div>
  );
}
