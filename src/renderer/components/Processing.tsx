import React from 'react'
import type { ProcessingTask } from '../types'

interface ProcessingProps {
  task: ProcessingTask
}

function Processing({ task }: ProcessingProps) {
  return (
    <div id="processing" role="status" aria-live="polite" aria-busy="true">
      <div className="processing-message">
        <div className="loading-anim" aria-hidden="true">
          <div className="circle"></div>
          <div className="circle"></div>
          <div className="circle"></div>
          <div className="circle"></div>
          <div className="circle"></div>
        </div>
        <h1>{task.title}</h1>
        <p>{task.description}</p>
        {task.stage && (
          <div className="processing-progress">
            <div className="processing-progress-label">
              <strong>{task.stage}</strong>
              {task.step && task.totalSteps && (
                <span>{`${task.step} / ${task.totalSteps}`}</span>
              )}
            </div>
            <div className="processing-progress-track" aria-hidden="true">
              <span></span>
            </div>
            <div className="processing-progress-detail">
              {task.currentItem && task.totalItems ? (
                <span>{`人物 ${task.currentItem} / ${task.totalItems}`}</span>
              ) : (
                <span></span>
              )}
              {task.cacheHit && <span>キャッシュを利用</span>}
            </div>
          </div>
        )}
        <p className="processing-note">
          動画の長さや実行環境によっては時間がかかる場合があります。
        </p>
      </div>
    </div>
  )
}

export default Processing
