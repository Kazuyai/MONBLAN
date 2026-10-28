interface TimelineControlsProps {
  isPlaying: boolean
  undoDisabled: boolean
  redoDisabled: boolean
  onJumpToStart: () => void
  onPreviousFrame: () => void
  onTogglePlayback: () => void
  onNextFrame: () => void
  onJumpToEnd: () => void
  onTogglePartialPlayback: () => void
  onAddLayer: () => void
  onDeleteLayer: () => void
  onAddAnnotation: () => void
  onDeleteAnnotation: () => void
  onMergeAnnotations: () => void
  onSplitAnnotations: () => void
  onUndo: () => void
  onRedo: () => void
}

const TimelineControls = ({
  isPlaying,
  undoDisabled,
  redoDisabled,
  onJumpToStart,
  onPreviousFrame,
  onTogglePlayback,
  onNextFrame,
  onJumpToEnd,
  onTogglePartialPlayback,
  onAddLayer,
  onDeleteLayer,
  onAddAnnotation,
  onDeleteAnnotation,
  onMergeAnnotations,
  onSplitAnnotations,
  onUndo,
  onRedo
}: TimelineControlsProps) => (
  <div className="controls">
    <button
      className="icon-button"
      onClick={onJumpToStart}
      aria-label="先頭へ移動"
    >
      <img src="./skip_start.svg" alt="" />
    </button>
    <button
      className="icon-button"
      onClick={onPreviousFrame}
      aria-label="1フレーム戻る"
    >
      <img src="./1f_left.svg" alt="" />
    </button>
    <button
      className="icon-button primary-action"
      onClick={onTogglePlayback}
      aria-label={isPlaying ? '一時停止' : '再生'}
    >
      <img src={isPlaying ? './pause.svg' : './play.svg'} alt="" />
    </button>
    <button
      className="icon-button"
      onClick={onNextFrame}
      aria-label="1フレーム進む"
    >
      <img src="./1f_right.svg" alt="" />
    </button>
    <button
      className="icon-button"
      onClick={onJumpToEnd}
      aria-label="末尾へ移動"
    >
      <img src="./skip_end.svg" alt="" />
    </button>
    <button className="secondary-action" onClick={onTogglePartialPlayback}>
      部分再生
    </button>
    <button className="secondary-action" onClick={onAddLayer}>
      注釈層追加
    </button>
    <button className="danger-action" onClick={onDeleteLayer}>
      注釈層削除
    </button>
    <button className="secondary-action" onClick={onAddAnnotation}>
      注釈追加
    </button>
    <button className="danger-action" onClick={onDeleteAnnotation}>
      注釈削除
    </button>
    <button className="secondary-action" onClick={onMergeAnnotations}>
      結合
    </button>
    <button className="secondary-action" onClick={onSplitAnnotations}>
      分割
    </button>
    <button
      className="secondary-action"
      onClick={onUndo}
      disabled={undoDisabled}
    >
      戻す
    </button>
    <button
      className="secondary-action"
      onClick={onRedo}
      disabled={redoDisabled}
    >
      進める
    </button>
  </div>
)

export default TimelineControls
