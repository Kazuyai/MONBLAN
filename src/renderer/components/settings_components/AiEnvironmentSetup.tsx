import React, { useEffect, useState } from 'react'
import type {
  ApiEnvironmentCheck,
  ApiStatus,
  AiSetupStatus
} from '../../../main/preload'

interface AiEnvironmentSetupProps {
  apiStatus: ApiStatus | null
  onRefresh: () => Promise<void>
  onRestart: () => Promise<void>
}

interface EnvironmentGroupPresentation {
  label: string
  description: string
  order: number
}

interface EnvironmentCheckGroup {
  id: string
  category: 'runtime' | 'external' | 'bundled'
  checks: ApiEnvironmentCheck[]
}

const environmentGroupPresentation: Record<
  string,
  EnvironmentGroupPresentation
> = {
  python: {
    label: 'Python実行環境',
    description: 'AI APIが現在使用しているPythonです。',
    order: 0
  },
  'cuda-pytorch': {
    label: 'PyTorch・CUDA・GPU',
    description: 'GPUを使用して姿勢推定を実行するために必要です。',
    order: 1
  },
  alphapose: {
    label: 'AlphaPose本体',
    description: '動画から2次元姿勢を推定する外部プログラムです。',
    order: 2
  },
  'alphapose-model': {
    label: 'AlphaPoseモデル',
    description: 'AlphaPoseが姿勢推定に使用する学習済みモデルです。',
    order: 3
  },
  motionbert: {
    label: 'MotionBERT本体',
    description: '2次元姿勢を3次元姿勢へ変換する外部プログラムです。',
    order: 4
  },
  'motionbert-model': {
    label: 'MotionBERTモデル',
    description: 'MotionBERTが姿勢推定に使用する学習済みモデルです。',
    order: 5
  },
  'application-files': {
    label: 'アプリ内AI処理ファイル',
    description: 'Annotation Toolに同梱される処理ファイルです。',
    order: 6
  }
}

const getCheckCategory = (
  check: ApiEnvironmentCheck
): 'runtime' | 'external' | 'bundled' => {
  if (check.category) return check.category
  if (
    check.name === 'detect_movement directory' ||
    (check.name.endsWith('script') &&
      !check.name.startsWith('AlphaPose') &&
      !check.name.startsWith('MotionBERT'))
  ) {
    return 'bundled'
  }
  if (check.name.startsWith('AlphaPose') || check.name.startsWith('MotionBERT')) {
    return 'external'
  }
  return 'runtime'
}

const getCheckGroup = (check: ApiEnvironmentCheck) => {
  if (check.group) return check.group
  if (check.name === 'Python executable') return 'python'
  if (check.name === 'CUDA / PyTorch') return 'cuda-pytorch'
  if (check.name === 'AlphaPose checkpoint') return 'alphapose-model'
  if (check.name.startsWith('AlphaPose')) return 'alphapose'
  if (check.name === 'MotionBERT checkpoint') return 'motionbert-model'
  if (check.name.startsWith('MotionBERT')) return 'motionbert'
  return 'application-files'
}

const getStatusPresentation = (apiStatus: ApiStatus | null) => {
  if (!apiStatus || apiStatus.status === 'starting') {
    return {
      className: 'checking',
      label: '確認中',
      description: 'AI機能を利用できる環境か確認しています。'
    }
  }

  if (apiStatus.status === 'ready' && apiStatus.aiAvailable) {
    return {
      className: 'available',
      label: '利用可能',
      description: '動作範囲検出と注釈補完を利用できます。'
    }
  }

  if (apiStatus.status === 'failed' || apiStatus.status === 'unavailable') {
    return {
      className: 'error',
      label: 'API接続エラー',
      description:
        'AI APIの起動または接続に失敗しました。環境不足とは分けて確認してください。'
    }
  }

  if (apiStatus.status === 'stopped') {
    return {
      className: 'error',
      label: 'API停止中',
      description: 'AI APIが停止しています。APIを再起動してください。'
    }
  }

  return {
    className: 'incomplete',
    label: 'セットアップが必要',
    description: '不足している項目を準備するとAI機能を利用できます。'
  }
}

const AiEnvironmentSetup: React.FC<AiEnvironmentSetupProps> = ({
  apiStatus,
  onRefresh,
  onRestart
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [isPreparingStorage, setIsPreparingStorage] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [setupStatus, setSetupStatus] = useState<AiSetupStatus | null>(null)
  const presentation = getStatusPresentation(apiStatus)
  const checks = apiStatus?.environment?.checks ?? []
  const aiAvailable =
    apiStatus?.status === 'ready' && apiStatus.aiAvailable === true
  const checkGroups = checks.reduce((groups, check) => {
    const groupId = getCheckGroup(check)
    const group = groups.get(groupId) ?? {
      id: groupId,
      category: getCheckCategory(check),
      checks: [] as ApiEnvironmentCheck[]
    }
    group.checks.push(check)
    groups.set(groupId, group)
    return groups
  }, new Map<string, EnvironmentCheckGroup>())
  const groupedChecks = Array.from(checkGroups.values()).sort(
    (left, right) =>
      (environmentGroupPresentation[left.id]?.order ?? 99) -
      (environmentGroupPresentation[right.id]?.order ?? 99)
  )
  const setupGroups = groupedChecks.filter(
    (group) => group.category !== 'bundled' && group.id !== 'python'
  )
  const bundledFailures = groupedChecks.filter(
    (group) =>
      group.category === 'bundled' &&
      group.checks.some((check) => !check.ok)
  )
  const pythonCheck = checks.find((check) => getCheckGroup(check) === 'python')
  const cudaCheck = checks.find(
    (check) => getCheckGroup(check) === 'cuda-pytorch'
  )

  useEffect(() => {
    let isMounted = true
    const unsubscribe = window.electronAPI?.onAiSetupStatusChanged((status) => {
      if (isMounted) setSetupStatus(status)
    })

    const loadSetupStatus = async () => {
      try {
        const status = await window.electronAPI?.getAiSetupStatus()
        if (isMounted && status) setSetupStatus(status)
      } catch (error) {
        if (!isMounted) return
        setActionError(
          error instanceof Error
            ? error.message
            : 'AI環境の保存先を確認できませんでした。'
        )
      }
    }

    loadSetupStatus()
    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [])

  const runAction = async (
    action: () => Promise<void>,
    setIsRunning: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    setActionError(null)
    setIsRunning(true)
    try {
      await action()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '処理に失敗しました。'
      )
    } finally {
      setIsRunning(false)
    }
  }

  const prepareStorage = async () => {
    if (!window.electronAPI) {
      setActionError('Electron APIを利用できません。')
      return
    }
    setActionError(null)
    setIsPreparingStorage(true)
    try {
      const status = await window.electronAPI.runAiSetupOperation(
        'prepare-storage'
      )
      setSetupStatus(status)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'AI環境の保存先を準備できませんでした。'
      )
    } finally {
      setIsPreparingStorage(false)
    }
  }

  return (
    <div id="ai-environment-setup">
      <section className="ai-environment-summary">
        <div>
          <h2>{aiAvailable ? 'AI環境' : 'AI環境セットアップ'}</h2>
          <p>
            AI機能に必要なPython、CUDA、外部プログラム、モデルを確認します。
          </p>
        </div>
        <span className={`ai-environment-status ${presentation.className}`}>
          {presentation.label}
        </span>
      </section>

      <p className="ai-environment-description">{presentation.description}</p>

      {setupStatus && (
        <section className="ai-environment-card ai-environment-storage">
          <div className="ai-environment-storage-header">
            <div>
              <h3>AI環境の保存先</h3>
              <p>
                配布版でも書き込み可能な専用領域にAI環境を構築します。
              </p>
            </div>
            <span className={setupStatus.prepared ? 'prepared' : ''}>
              {setupStatus.prepared ? '準備済み' : '未準備'}
            </span>
          </div>
          <code>{setupStatus.rootPath}</code>
          {!setupStatus.prepared && (
            <button
              type="button"
              disabled={isPreparingStorage || setupStatus.phase === 'running'}
              onClick={prepareStorage}
            >
              {isPreparingStorage ? '準備中…' : '保存先を準備'}
            </button>
          )}
          <p className="ai-environment-storage-note">
            この操作では保存先だけを作成します。現在使用中のAI環境やPythonは変更しません。
          </p>
        </section>
      )}

      {actionError && (
        <div className="ai-environment-action-error" role="alert">
          {actionError}
        </div>
      )}

      {apiStatus?.error && (
        <div className="ai-environment-action-error" role="alert">
          {apiStatus.error}
        </div>
      )}

      {setupGroups.length > 0 && (
        <section className="ai-environment-card">
          <h3>セットアップ項目</h3>
          <ul className="ai-environment-check-list">
            {setupGroups.map((group) => {
              const groupOk = group.checks.every((check) => check.ok)
              const groupPresentation = environmentGroupPresentation[group.id]
              const missingChecks = group.checks.filter((check) => !check.ok)
              return (
                <li key={group.id}>
                  <span
                    className={`ai-environment-check-mark ${groupOk ? 'ok' : 'ng'}`}
                    aria-label={groupOk ? '正常' : '不足'}
                  >
                    {groupOk ? '✓' : '!'}
                  </span>
                  <div>
                    <strong>{groupPresentation?.label ?? group.id}</strong>
                    <span>{groupPresentation?.description}</span>
                    {missingChecks.map((check) => (
                      <span key={`${check.name}-${check.path ?? ''}`}>
                        {check.path ?? check.error ?? check.name}
                      </span>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {checks.length > 0 && (
        <section className="ai-environment-card ai-environment-runtime-info">
          <h3>実行環境情報</h3>
          <dl>
            <div>
              <dt>Python</dt>
              <dd>{pythonCheck?.path ?? '取得できませんでした'}</dd>
            </div>
            <div>
              <dt>PyTorch</dt>
              <dd>{cudaCheck?.torch_version ?? '取得できませんでした'}</dd>
            </div>
            <div>
              <dt>CUDA</dt>
              <dd>{cudaCheck?.cuda_version ?? '利用できません'}</dd>
            </div>
            <div>
              <dt>GPU</dt>
              <dd>{`${cudaCheck?.device_count ?? 0}台`}</dd>
            </div>
          </dl>
        </section>
      )}

      {bundledFailures.length > 0 && (
        <section
          className="ai-environment-card ai-environment-integrity-error"
          role="alert"
        >
          <h3>アプリの構成ファイルが不足しています</h3>
          <p>
            利用者がセットアップする項目ではありません。アプリを再取得または再インストールしてください。
          </p>
          <ul>
            {bundledFailures.flatMap((group) =>
              group.checks
                .filter((check) => !check.ok)
                .map((check) => (
                  <li key={check.name}>{check.path ?? check.name}</li>
                ))
            )}
          </ul>
        </section>
      )}

      {!aiAvailable && setupGroups.length > 0 && (
        <p className="ai-environment-note">
          現在は診断と再確認のみ行います。環境を変更する処理は、次の段階で安全確認を加えて接続します。
        </p>
      )}

      {checks.length > 0 && (
        <details className="ai-environment-details">
          <summary>詳細な診断情報</summary>
          <ul>
            {checks.map((check) => (
              <li key={`${check.name}-${check.path ?? ''}`}>
                <strong>
                  {check.ok ? 'OK' : 'NG'}: {check.name}
                </strong>
                {check.path && <span>{check.path}</span>}
                {check.error && <span>{check.error}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!aiAvailable && !apiStatus?.environment && (
        <section className="ai-environment-card">
          <h3>AI機能について</h3>
          <p>
            AI環境が利用可能になると「動作範囲検出」と「注釈補完」タブが表示されます。手動アノテーション機能はこの状態でも利用できます。
          </p>
        </section>
      )}

      <div className="ai-environment-actions">
        <button
          type="button"
          disabled={isRefreshing || isRestarting}
          onClick={() => runAction(onRefresh, setIsRefreshing)}
        >
          {isRefreshing ? '確認中…' : '環境を再確認'}
        </button>
        <button
          type="button"
          disabled={isRefreshing || isRestarting}
          onClick={() => runAction(onRestart, setIsRestarting)}
        >
          {isRestarting ? '接続中…' : 'AI APIを起動・再接続'}
        </button>
      </div>
    </div>
  )
}

export default AiEnvironmentSetup
