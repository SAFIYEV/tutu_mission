"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP);

export function useScreenEntrance(scope: RefObject<HTMLElement | null>) {
  useGSAP(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    gsap.from("[data-enter]", {
      opacity: 0,
      y: 18,
      duration: 0.62,
      stagger: 0.07,
      ease: "power3.out",
      clearProps: "opacity,transform",
    });
  }, { scope });
}

export { gsap, useGSAP };
