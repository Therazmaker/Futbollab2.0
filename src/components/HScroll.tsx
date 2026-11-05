"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * Carril horizontal que se puede desplazar con el dedo, con la rueda del ratón
 * (vertical → horizontal) y arrastrando. Muestra flechas cuando hay más contenido.
 */
export function HScroll({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, []);

  const by = (dx: number) => ref.current?.scrollBy({ left: dx, behavior: "smooth" });

  return (
    <div className="relative w-full min-w-0">
      <div
        ref={ref}
        onScroll={update}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") return;
          drag.current = { x: e.clientX, left: ref.current!.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x;
          if (Math.abs(dx) > 4) drag.current.moved = true;
          ref.current!.scrollLeft = drag.current.left - dx;
        }}
        onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
        onPointerLeave={() => (drag.current = null)}
        onClickCapture={(e) => {
          // Si fue un arrastre, no cuenta como clic en un botón
          if (drag.current?.moved) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        className={`flex overflow-x-auto no-scrollbar min-w-0 ${className}`}
      >
        {children}
      </div>
      {edges.left && (
        <button
          type="button"
          aria-label="Desplazar a la izquierda"
          onClick={() => by(-200)}
          className="absolute left-0 top-0 bottom-1 w-7 flex items-center justify-start bg-gradient-to-r from-background to-transparent text-on-surface-variant hover:text-primary"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
        </button>
      )}
      {edges.right && (
        <button
          type="button"
          aria-label="Desplazar a la derecha"
          onClick={() => by(200)}
          className="absolute right-0 top-0 bottom-1 w-7 flex items-center justify-end bg-gradient-to-l from-background to-transparent text-on-surface-variant hover:text-primary"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
        </button>
      )}
    </div>
  );
}
