import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Clarity Mesh — Per-frame deepfake score timeline (recharts).
 *
 * Plots the genuine per-frame model scores recorded during video analysis
 * (visual_analysis.per_frame_scores). Nothing is interpolated: every point
 * is one sampled frame's mean per-face score. Clicking the chart seeks the
 * video preview (`#cm-preview-video`) to that frame via the onSeek callback.
 */
export default function FrameTimeline({
  perFrameScores,
  fps,
  durationSeconds,
  threshold,
  onSeek,
  onSelectFrame,
  selectedFrame,
}) {
  const [hoverPoint, setHoverPoint] = useState(null);

  const data = useMemo(
    () =>
      (perFrameScores || []).map((point) => ({
        frame: point.frame,
        t: point.timestamp_s !== undefined ? point.timestamp_s : (fps > 0 ? Number((point.frame / fps).toFixed(3)) : null),
        score: point.score,
        top_face_box: point.top_face_box,
      })),
    [perFrameScores, fps],
  );

  if (!data.length) return null;

  const useTime = fps > 0;
  const xKey = useTime ? 't' : 'frame';
  const flagged = data.filter(
    (d) => typeof threshold === 'number' && d.score >= threshold,
  ).length;

  const handleChartClick = () => {
    if (hoverPoint) {
      if (onSeek) onSeek(hoverPoint.frame);
      if (onSelectFrame) onSelectFrame(hoverPoint.frame);
    }
  };

  const tickFormatter = (value) =>
    useTime ? `${Number(value).toFixed(1)}s` : `f${value}`;

  const tooltipLabel = (payload) => {
    const point = payload?.[0]?.payload;
    if (!point) return '';
    const timeStr = point.t !== null ? ` · ${point.t}s` : '';
    const boxStr = point.top_face_box ? ` · Box: ${point.top_face_box.width}x${point.top_face_box.height}` : '';
    return `Frame ${point.frame}${timeStr}${boxStr}`;
  };

  return (
    <div className="glass-card p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-white uppercase tracking-wider">
          🎬 Per-Frame Deepfake Score Timeline
        </h4>
        <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
          <span>{data.length} sampled frames</span>
          {typeof threshold === 'number' && (
            <span className="text-amber-300">
              {flagged} at/above threshold {threshold.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      <div className="h-44 w-full select-none" role="img" aria-label="Per-frame fake score timeline">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 4, left: -18 }}
            onMouseMove={(state) =>
              setHoverPoint(state?.activePayload?.[0]?.payload ?? null)
            }
            onMouseLeave={() => setHoverPoint(null)}
            onClick={handleChartClick}
            style={{ cursor: 'pointer' }}
          >
            <defs>
              <linearGradient id="cmScoreFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#06B6D4" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
            <XAxis
              dataKey={xKey}
              tickFormatter={tickFormatter}
              stroke="#64748B"
              tick={{ fontSize: 10, fontFamily: 'monospace' }}
              minTickGap={28}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              stroke="#64748B"
              tick={{ fontSize: 10, fontFamily: 'monospace' }}
              width={42}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(2,6,23,0.95)',
                border: '1px solid rgba(6,182,212,0.4)',
                borderRadius: 10,
                fontSize: 11,
              }}
              labelFormatter={tooltipLabel}
              formatter={(value) => [value, 'Fake-oriented score']}
            />
            {typeof threshold === 'number' && (
              <ReferenceLine
                y={threshold}
                stroke="#F59E0B"
                strokeDasharray="6 4"
                label={{
                  value: `threshold ${threshold.toFixed(2)}`,
                  position: 'insideTopRight',
                  fill: '#FCD34D',
                  fontSize: 10,
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="score"
              stroke="#22D3EE"
              strokeWidth={2}
              fill="url(#cmScoreFill)"
              dot={false}
              activeDot={{ r: 4, fill: '#22D3EE', stroke: '#020617', strokeWidth: 1.5 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        Every point is a genuine model score for one sampled frame (mean of its
        per-face scores) — never interpolated.{' '}
        <span className="text-cyan-300 font-semibold">
          Hover a point, then click the chart to seek the preview to that frame.
        </span>{' '}
        Scores are uncalibrated model outputs, not probabilities.
      </p>
    </div>
  );
}
