interface Props {
  leftPct: number
  widthPct: number
  selected: boolean
  label: string
  onBodyDown: (e: React.PointerEvent) => void
  onLeftDown: (e: React.PointerEvent) => void
  onRightDown: (e: React.PointerEvent) => void
}

export function ZoomSegmentBlock({
  leftPct,
  widthPct,
  selected,
  label,
  onBodyDown,
  onLeftDown,
  onRightDown
}: Props): JSX.Element {
  return (
    <div
      className={`zseg${selected ? ' zseg--sel' : ''}`}
      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      onPointerDown={onBodyDown}
      title={label}
    >
      <div
        className="zseg__handle zseg__handle--l"
        onPointerDown={onLeftDown}
      />
      <span className="zseg__label">{label}</span>
      <div
        className="zseg__handle zseg__handle--r"
        onPointerDown={onRightDown}
      />
    </div>
  )
}
