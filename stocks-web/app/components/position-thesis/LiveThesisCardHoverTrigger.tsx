'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LiveThesisCardPanel } from './LiveThesisCard';

const HOVER_LEAVE_MS = 200;

/** Small (i) control; hover shows a floating Live Thesis Card preview (portaled to avoid table overflow clipping). */
export default function LiveThesisCardHoverTrigger() {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current != null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updatePosition]);

  const handleEnter = useCallback(() => {
    clearLeaveTimer();
    const el = btnRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setCoords({ top: r.bottom + 6, left: r.left });
    }
    setOpen(true);
  }, [clearLeaveTimer]);

  const handleLeave = useCallback(() => {
    clearLeaveTimer();
    leaveTimerRef.current = setTimeout(() => setOpen(false), HOVER_LEAVE_MS);
  }, [clearLeaveTimer]);

  const panel =
    open &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="fixed z-[9999] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-2 shadow-xl ring-1 ring-black/5"
        style={{ top: coords.top, left: coords.left }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        role="tooltip"
      >
        <p className="text-xs text-gray-500 px-1 pb-2 border-b border-gray-100 mb-2">
          Sample live thesis snapshot (builder sidebar)
        </p>
        <LiveThesisCardPanel />
      </div>,
      document.body
    );

  return (
    <>
      <div
        className="relative inline-flex items-center align-middle"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <button
          ref={btnRef}
          type="button"
          className="inline-flex h-5 min-w-[1.25rem] px-1 items-center justify-center rounded-full border border-gray-300 text-[10px] font-bold leading-none text-gray-600 hover:bg-gray-100 hover:border-gray-400"
          aria-label="Live thesis card preview"
          aria-expanded={open}
        >
          (i)
        </button>
      </div>
      {panel}
    </>
  );
}
