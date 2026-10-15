import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface AnalysisStepsProps {
  labels: string[]
  currentStep: number
  onBack: (step: number) => void
}

export const AnalysisSteps: React.FC<AnalysisStepsProps> = ({
  labels,
  currentStep,
  onBack
}) => {
  const [pendingStep, setPendingStep] = useState<number | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const navigationRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (pendingStep !== null || !triggerRef.current) return
    if (triggerRef.current.isConnected) {
      triggerRef.current.focus()
    } else {
      navigationRef.current?.focus()
    }
    triggerRef.current = null
  }, [pendingStep])

  useEffect(() => {
    if (pendingStep === null) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingStep(null)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [pendingStep])

  const confirmBack = () => {
    if (pendingStep === null) return
    onBack(pendingStep)
    setPendingStep(null)
  }

  const openBackDialog = (targetStep: number, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger
    setPendingStep(targetStep)
  }

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
    const firstButton = buttons[0]
    const lastButton = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === firstButton) {
      event.preventDefault()
      lastButton.focus()
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault()
      firstButton.focus()
    }
  }

  return (
    <>
      <nav
        ref={navigationRef}
        className="analysis-step-navigation"
        aria-label="分析の手順"
        tabIndex={-1}
      >
        <ol
          className="analysis-steps"
          style={{ '--analysis-step-line-inset': `${50 / labels.length}%` } as React.CSSProperties}
        >
          {labels.map((label, index) => (
            <li
              key={label}
              className={index === currentStep ? 'active' : index < currentStep ? 'done' : 'upcoming'}
            >
              {index < currentStep ? (
                <button
                  type="button"
                  className="analysis-step-item"
                  onClick={(event) => openBackDialog(index, event.currentTarget)}
                  aria-label={`${label}の設定に戻る`}
                >
                  <span className="analysis-step-number" aria-hidden="true">{index + 1}</span>
                  <span className="analysis-step-label">{label}</span>
                </button>
              ) : (
                <span
                  className="analysis-step-item"
                  aria-current={index === currentStep ? 'step' : undefined}
                >
                  <span className="analysis-step-number" aria-hidden="true">{index + 1}</span>
                  <span className="analysis-step-label">{label}</span>
                </span>
              )}
            </li>
          ))}
        </ol>
        {currentStep > 0 && (
          <button
            type="button"
            className="analysis-step-back"
            onClick={(event) => openBackDialog(currentStep - 1, event.currentTarget)}
          >
            <span aria-hidden="true">←</span>
            前のステップへ
          </button>
        )}
      </nav>
      {pendingStep !== null && createPortal(
        <div className="analysis-step-dialog-backdrop" onMouseDown={() => setPendingStep(null)}>
          <div
            className="analysis-step-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="analysis-step-dialog-title"
            aria-describedby="analysis-step-dialog-description"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={handleDialogKeyDown}
          >
            <h2 id="analysis-step-dialog-title">前のステップに戻りますか？</h2>
            <p id="analysis-step-dialog-description">
              現在のステップ以降の設定と未採用の候補は破棄されます。すでに追加した注釈は削除されません。
            </p>
            <div className="analysis-step-dialog-actions">
              <button type="button" autoFocus onClick={() => setPendingStep(null)}>
                キャンセル
              </button>
              <button
                type="button"
                className="danger-action"
                onClick={confirmBack}
              >
                設定を破棄して戻る
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
