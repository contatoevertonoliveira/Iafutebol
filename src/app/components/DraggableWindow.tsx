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
  const draggingRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      if (e.pointerId !== draggingRef.current.pointerId) return;
      const nextX = draggingRef.current.originX + (e.clientX - draggingRef.current.startX);
      const nextY = draggingRef.current.originY + (e.clientY - draggingRef.current.startY);
      setPos({ x: nextX, y: nextY });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      if (e.pointerId !== draggingRef.current.pointerId) return;
      draggingRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

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

  return (
    <div
      className="fixed rounded-xl shadow-2xl border border-gray-200 bg-white overflow-hidden pointer-events-auto"
      style={{
        left: pos.x,
        top: pos.y,
        width: initialSize.width,
        height: initialSize.height,
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
    </div>
  );
}
