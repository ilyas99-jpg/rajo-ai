import type { CSSProperties } from "react";

const BRAND_BLUE = "#467ED3";
const WAVEFORM_BARS = [0.24, 0.36, 0.5, 0.66, 0.82, 0.94, 1, 0.94, 0.82, 0.66, 0.5, 0.36, 0.24];
const BAR_WIDTH = 10;
const BAR_GAP = 4;
const MAX_BAR_HEIGHT = 84;
const WAVEFORM_CENTER_Y = 48;

type BrandWaveformProps = {
  className?: string;
  color?: string;
  opacity?: number;
  size?: number | string;
};

export function BrandWaveform({
  className,
  color = BRAND_BLUE,
  opacity = 1,
  size,
}: BrandWaveformProps) {
  const style: CSSProperties | undefined = size
    ? { width: typeof size === "number" ? `${size}px` : size }
    : undefined;

  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
      style={style}
      viewBox="0 0 178 96"
    >
      <g fill={color} opacity={opacity}>
        {WAVEFORM_BARS.map((factor, index) => {
          const height = MAX_BAR_HEIGHT * factor;
          return (
            <rect
              height={height}
              key={`${factor}-${index}`}
              rx={BAR_WIDTH / 2}
              width={BAR_WIDTH}
              x={index * (BAR_WIDTH + BAR_GAP)}
              y={WAVEFORM_CENTER_Y - height / 2}
            />
          );
        })}
      </g>
    </svg>
  );
}
