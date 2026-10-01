import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import { createGame, type GameHandle } from './game/celeste';

function TouchButton({
  label,
  index,
  game,
  className = '',
}: {
  label: string;
  index: number;
  game: MutableRefObject<GameHandle | null>;
  className?: string;
}) {
  const down = (e: RPointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    game.current?.setButton(index, true);
  };
  const up = (e: RPointerEvent) => {
    e.preventDefault();
    game.current?.setButton(index, false);
  };
  return (
    <button
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      className={`select-none touch-none rounded-xl border-2 border-[#5f574f] bg-[#1d2b53]/80 text-[#fff1e8] font-bold active:bg-[#7e2553] ${className}`}
    >
      {label}
    </button>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameHandle | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const g = createGame(canvasRef.current);
    gameRef.current = g;
    return () => {
      g.stop();
      gameRef.current = null;
    };
  }, []);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    gameRef.current?.setMuted(m);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center gap-3 bg-[#0b0b10] text-[#c2c3c7] p-2 select-none">
      <h1 className="text-[#ff77a8] tracking-[0.3em] text-sm sm:text-base font-bold uppercase">Celeste Classic</h1>

      <div className="relative p-2 sm:p-3 rounded-lg bg-[#1d2b53] shadow-[0_0_40px_rgba(255,0,77,0.25)]">
        <canvas
          ref={canvasRef}
          className="block bg-black"
          style={{
            width: 'min(92vw, calc(100vh - 230px), 720px)',
            height: 'min(92vw, calc(100vh - 230px), 720px)',
            imageRendering: 'pixelated',
          }}
        />
      </div>

      <div className="flex items-center gap-3 text-[11px] sm:text-xs text-[#83769c]">
        <span>
          <b className="text-[#fff1e8]">← ↑ → ↓</b> mover
        </span>
        <span>
          <b className="text-[#fff1e8]">Z / C</b> saltar
        </span>
        <span>
          <b className="text-[#fff1e8]">X / V</b> dash
        </span>
        <button
          onClick={toggleMute}
          className="px-2 py-0.5 rounded border border-[#5f574f] text-[#c2c3c7] hover:bg-[#1d2b53]"
        >
          {muted ? '🔇 sonido' : '🔊 sonido'}
        </button>
      </div>

      {/* controles tactiles */}
      <div className="flex w-full max-w-[420px] justify-between items-end px-2 [@media(hover:hover)_and_(pointer:fine)]:hidden">
        <div className="grid grid-cols-3 grid-rows-3 gap-1 w-36 h-36">
          <span />
          <TouchButton label="▲" index={2} game={gameRef} />
          <span />
          <TouchButton label="◀" index={0} game={gameRef} />
          <span />
          <TouchButton label="▶" index={1} game={gameRef} />
          <span />
          <TouchButton label="▼" index={3} game={gameRef} />
          <span />
        </div>
        <div className="flex gap-3 pb-2">
          <TouchButton label="DASH" index={5} game={gameRef} className="w-20 h-20 rounded-full text-sm" />
          <TouchButton label="SALTO" index={4} game={gameRef} className="w-20 h-20 rounded-full text-sm mt-[-20px]" />
        </div>
      </div>
    </div>
  );
}
