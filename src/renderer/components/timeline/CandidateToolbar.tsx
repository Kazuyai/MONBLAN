interface CandidateToolbarProps {
  title: string
  totalCount: number
  insertableCount: number
  conflictingCount: number
  movement?: boolean
  onInsertAll: () => void
  onDiscardAll: () => void
}

const CandidateToolbar = ({
  title,
  totalCount,
  insertableCount,
  conflictingCount,
  movement = false,
  onInsertAll,
  onDiscardAll
}: CandidateToolbarProps) => (
  <div
    className={`similarity-candidate-toolbar${movement ? ' movement-candidate-toolbar' : ''}`}
  >
    <div className="similarity-candidate-toolbar-summary">
      <span>{`${title}: ${totalCount}件`}</span>
      <span>{`挿入可能: ${insertableCount}件`}</span>
      {conflictingCount > 0 && (
        <span className="conflict-count">{`重複: ${conflictingCount}件`}</span>
      )}
    </div>
    <div className="similarity-candidate-toolbar-actions">
      <button
        type="button"
        disabled={insertableCount === 0}
        onClick={onInsertAll}
      >
        すべて挿入
      </button>
      <button type="button" onClick={onDiscardAll}>
        候補を破棄
      </button>
    </div>
  </div>
)

export default CandidateToolbar
