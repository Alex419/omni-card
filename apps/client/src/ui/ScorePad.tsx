import type { SeatView } from '@omni/shared';

interface Props {
  seats: SeatView[];
  canPlay: boolean;
  onScore: (seat: number, delta: number) => void;
  onClose: () => void;
}

export function ScorePad({ seats, canPlay, onScore, onClose }: Props) {
  const rows = seats.filter((s) => s.player || s.score !== 0);
  return (
    <div className="score panel">
      <div className="shead">
        SCORE PAD
        <button onClick={onClose} aria-label="Close score pad">
          X
        </button>
      </div>
      {rows.map((s) => (
        <div className="srow" key={s.seat}>
          <span className={`sprite av-${s.seat}`} />
          <span>{s.player?.name ?? `SEAT ${s.seat + 1}`}</span>
          <span className="sval">{s.score}</span>
          {canPlay &&
            [-1, 1, 5].map((d) => (
              <button key={d} onClick={() => onScore(s.seat, d)}>
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}
