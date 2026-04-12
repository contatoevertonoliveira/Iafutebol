import { ReactNode, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface DraggableWindowProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  zIndex: number;
  onFocus: () => void;
}

export function DraggableWindow({
  title,
  children,
  onClose,
  initialPosition = { x: 80, y: 80 },
  initialSize = { width: 960, height: 720 },
  zIndex,
  onFocus,
}: DraggableWindowProps) {
  const [pos, setPos] = useState(initialPosition);
  const [size, setSize] = useState(initialSize);
  const draggingRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const resizingRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originW: number;
    originH: number;
  } | null>(null);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (draggingRef.current && e.pointerId === draggingRef.current.pointerId) {
        const nextX = draggingRef.current.originX + (e.clientX - draggingRef.current.startX);
        const nextY = draggingRef.current.originY + (e.clientY - draggingRef.current.startY);
        const maxX = Math.max(8, window.innerWidth - size.width - 8);
        const maxY = Math.max(8, window.innerHeight - size.height - 8);
        setPos({
          x: Math.min(maxX, Math.max(8, nextX)),
          y: Math.min(maxY, Math.max(8, nextY)),
        });
        return;
      }

      if (resizingRef.current && e.pointerId === resizingRef.current.pointerId) {
        const nextW = resizingRef.current.originW + (e.clientX - resizingRef.current.startX);
        const nextH = resizingRef.current.originH + (e.clientY - resizingRef.current.startY);
        const minW = 520;
        const minH = 420;
        const maxW = Math.max(minW, window.innerWidth - pos.x - 8);
        const maxH = Math.max(minH, window.innerHeight - pos.y - 8);
        setSize({
          width: Math.min(maxW, Math.max(minW, nextW)),
          height: Math.min(maxH, Math.max(minH, nextH)),
        });
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (draggingRef.current && e.pointerId === draggingRef.current.pointerId) {
        draggingRef.current = null;
        return;
      }
      if (resizingRef.current && e.pointerId === resizingRef.current.pointerId) {
        resizingRef.current = null;
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [pos.x, pos.y, size.width, size.height]);

  useEffect(() => {
    const onWindowResize = () => {
      const minW = 520;
      const minH = 420;
      const nextW = Math.min(Math.max(minW, size.width), Math.max(minW, window.innerWidth - pos.x - 8));
      const nextH = Math.min(Math.max(minH, size.height), Math.max(minH, window.innerHeight - pos.y - 8));
      const maxX = Math.max(8, window.innerWidth - nextW - 8);
      const maxY = Math.max(8, window.innerHeight - nextH - 8);
      setSize({ width: nextW, height: nextH });
      setPos({ x: Math.min(maxX, Math.max(8, pos.x)), y: Math.min(maxY, Math.max(8, pos.y)) });
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [pos.x, pos.y, size.height, size.width]);

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onFocus();
    draggingRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    };
  };

  const onResizePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onFocus();
    resizingRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originW: size.width,
      originH: size.height,
    };
  };

  return (
    <div
      className="fixed rounded-xl shadow-2xl border border-gray-200 bg-white overflow-hidden pointer-events-auto"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: size.height,
        zIndex,
      }}
      onPointerDown={onFocus}
    >
      <div
        className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white cursor-move select-none"
        onPointerDown={onHeaderPointerDown}
      >
        <div className="font-semibold truncate">{title}</div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-white/20 rounded-lg transition-colors"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="h-[calc(100%-52px)] overflow-auto">{children}</div>
      <div
        className="absolute bottom-1 right-1 w-4 h-4 cursor-se-resize bg-gray-200 rounded-sm opacity-70 hover:opacity-100"
        onPointerDown={onResizePointerDown}
        aria-label="Redimensionar"
      />
    </div>
  );
}
