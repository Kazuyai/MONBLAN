interface TimelineZoomControlsProps {
  min: number
  max: number
  value: number
  onReset: () => void
  onChange: (value: number) => void
}

const TimelineZoomControls = ({
  min,
  max,
  value,
  onReset,
  onChange
}: TimelineZoomControlsProps) => (
  <div className="zoom-controls">
    <button onClick={onReset} aria-label="拡大率を初期値に戻す">
      <img src="./reset.svg" alt="" />
    </button>
    <input
      type="range"
      min={min}
      max={max}
      step={0.1}
      value={value}
      aria-label="タイムラインの拡大率"
      onChange={(event) => onChange(parseFloat(event.target.value))}
    />
  </div>
)

export default TimelineZoomControls
