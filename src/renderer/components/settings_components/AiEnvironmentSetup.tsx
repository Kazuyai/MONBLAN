import React, { useEffect, useState } from 'react'
import type {
  ApiEnvironmentCheck,
  ApiStatus,
  AiSetupModel,
  AiSetupOperation,
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
  'alphapose-detector-model': {
    label: 'AlphaPose人物検出モデル',
    description: '動画内から人物を検出するYOLOの学習済みモデルです。',
    order: 4
  },
  'alphapose-tracker-model': {
    label: 'AlphaPose人物追跡モデル',
    description: '動画内で人物を追跡し、人物IDを維持するための学習済みモデルです。',
    order: 5
  },
  motionbert: {
    label: 'MotionBERT本体',
    description: '2次元姿勢を3次元姿勢へ変換する外部プログラムです。',
    order: 6
  },
  'motionbert-model': {
    label: 'MotionBERTモデル',
    description: 'MotionBERTが姿勢推定に使用する学習済みモデルです。',
    order: 7
  },
  'application-files': {
    label: 'アプリ内AI処理ファイル',
    description: 'Annotation Toolに同梱される処理ファイルです。',
    order: 8
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
  if (check.name === 'AlphaPose detector checkpoint')
    return 'alphapose-detector-model'
  if (check.name === 'AlphaPose tracker checkpoint')
    return 'alphapose-tracker-model'
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
  const [pendingSetupOperation, setPendingSetupOperation] =
    useState<AiSetupOperation | null>(null)
  const [isCancellingSetup, setIsCancellingSetup] = useState(false)
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
  const dedicatedGroupState: Record<
    string,
    { ready: boolean; path: string } | undefined
  > = setupStatus
    ? {
        alphapose: {
          ready: setupStatus.alphaPoseReady,
          path: setupStatus.alphaPosePath
        },
        'alphapose-model': {
          ready: setupStatus.alphaPoseModelReady,
          path: setupStatus.alphaPoseModelPath
        },
        'alphapose-detector-model': {
          ready: setupStatus.alphaPoseDetectorModelReady,
          path: setupStatus.alphaPoseDetectorModelPath
        },
        'alphapose-tracker-model': {
          ready: setupStatus.alphaPoseTrackerModelReady,
          path: setupStatus.alphaPoseTrackerModelPath
        },
        motionbert: {
          ready: setupStatus.motionBertReady,
          path: setupStatus.motionBertPath
        },
        'motionbert-model': {
          ready: setupStatus.motionBertModelReady,
          path: setupStatus.motionBertModelPath
        }
      }
    : {}

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

  const runSetupOperation = async (operation: AiSetupOperation) => {
    if (!window.electronAPI) {
      setActionError('Electron APIを利用できません。')
      return
    }
    setActionError(null)
    setPendingSetupOperation(operation)
    try {
      const status = await window.electronAPI.runAiSetupOperation(operation)
      setSetupStatus(status)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'AI環境のセットアップ処理に失敗しました。'
      )
    } finally {
      setPendingSetupOperation(null)
    }
  }

  const setupIsRunning =
    pendingSetupOperation !== null || setupStatus?.phase === 'running'
  const activeSetupOperation =
    pendingSetupOperation ?? setupStatus?.operation ?? null
  const setupCanBeCancelled =
    setupIsRunning &&
    activeSetupOperation !== 'install-alphapose-model' &&
    activeSetupOperation !== 'install-alphapose-detector-model' &&
    activeSetupOperation !== 'install-alphapose-tracker-model' &&
    activeSetupOperation !== 'install-motionbert-model'

  const cancelSetupOperation = async () => {
    if (!window.electronAPI) return
    setIsCancellingSetup(true)
    try {
      const status = await window.electronAPI.cancelAiSetupOperation()
      setSetupStatus(status)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'セットアップ処理を中止できませんでした。'
      )
    } finally {
      setIsCancellingSetup(false)
    }
  }

  const openModelPage = async (model: AiSetupModel) => {
    try {
      await window.electronAPI?.openAiSetupModelPage(model)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'モデルの公式配布ページを開けませんでした。'
      )
    }
  }

  const installModel = async (model: AiSetupModel) => {
    if (!window.electronAPI) return
    const operation: AiSetupOperation =
      model === 'alphapose'
        ? 'install-alphapose-model'
        : model === 'alphapose-detector'
          ? 'install-alphapose-detector-model'
        : model === 'alphapose-tracker'
          ? 'install-alphapose-tracker-model'
          : 'install-motionbert-model'
    setActionError(null)
    setPendingSetupOperation(operation)
    try {
      const status = await window.electronAPI.installAiSetupModel(model)
      setSetupStatus(status)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'モデルファイルを配置できませんでした。'
      )
    } finally {
      setPendingSetupOperation(null)
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
              disabled={setupIsRunning}
              onClick={() => runSetupOperation('prepare-storage')}
            >
              {pendingSetupOperation === 'prepare-storage'
                ? '準備中…'
                : '保存先を準備'}
            </button>
          )}
          <p className="ai-environment-storage-note">
            この操作では保存先だけを作成します。現在使用中のAI環境やPythonは変更しません。
          </p>
        </section>
      )}

      {setupStatus?.prepared && (
        <section className="ai-environment-card ai-python-setup">
          <h3>Python環境の準備</h3>
          <ol className="ai-setup-step-list">
            <li
              className={
                setupStatus.python.available || setupStatus.venvReady
                  ? 'completed'
                  : ''
              }
            >
              <div className="ai-setup-step-header">
                <div>
                  <strong>1. Pythonを確認</strong>
                  <span>
                    {setupStatus.python.available
                      ? `Python ${setupStatus.python.version} (${setupStatus.python.command})`
                      : setupStatus.venvReady
                        ? '専用Python環境を確認済みです。'
                      : 'Python 3.11または3.12が必要です。'}
                  </span>
                </div>
                {!setupStatus.python.available && !setupStatus.venvReady && (
                  <button
                    type="button"
                    disabled={setupIsRunning}
                    onClick={() => runSetupOperation('check-python')}
                  >
                    {pendingSetupOperation === 'check-python'
                      ? '確認中…'
                      : '確認'}
                  </button>
                )}
              </div>
            </li>
            <li className={setupStatus.venvReady ? 'completed' : ''}>
              <div className="ai-setup-step-header">
                <div>
                  <strong>2. 専用Python環境を作成</strong>
                  <span>{setupStatus.venvPath}</span>
                </div>
                {!setupStatus.venvReady && (
                  <button
                    type="button"
                    disabled={setupIsRunning || !setupStatus.python.available}
                    onClick={() =>
                      runSetupOperation('create-python-environment')
                    }
                  >
                    {pendingSetupOperation === 'create-python-environment'
                      ? '作成中…'
                      : '作成'}
                  </button>
                )}
              </div>
            </li>
            <li className={setupStatus.dependenciesReady ? 'completed' : ''}>
              <div className="ai-setup-step-header">
                <div>
                  <strong>3. AI依存パッケージを導入</strong>
                  <span>
                    ダウンロード容量が大きく、完了まで時間がかかる場合があります。
                  </span>
                </div>
                {!setupStatus.dependenciesReady && (
                  <button
                    type="button"
                    disabled={setupIsRunning || !setupStatus.venvReady}
                    onClick={() =>
                      runSetupOperation('install-python-dependencies')
                    }
                  >
                    {pendingSetupOperation === 'install-python-dependencies'
                      ? '導入中…'
                      : 'インストール'}
                  </button>
                )}
              </div>
            </li>
          </ol>
          <p className="ai-environment-storage-note">
            専用環境への切り替えは、依存関係と外部AIプログラムの確認後に行います。現在使用中の環境には影響しません。
          </p>
        </section>
      )}

      {setupStatus?.dependenciesReady && (
        <section className="ai-environment-card ai-python-setup">
          <h3>外部AIプログラムの取得</h3>
          <ol className="ai-setup-step-list">
            <li className={setupStatus.alphaPoseReady ? 'completed' : ''}>
              <div className="ai-setup-step-header">
                <div>
                  <strong>4. AlphaPose本体を取得</strong>
                  <span>{setupStatus.alphaPosePath}</span>
                  <span>
                    公式リポジトリから取得します。AlphaPoseの利用条件は非商用用途に限定されています。
                  </span>
                </div>
                {!setupStatus.alphaPoseReady && (
                  <button
                    type="button"
                    disabled={setupIsRunning}
                    onClick={() => runSetupOperation('fetch-alphapose')}
                  >
                    {pendingSetupOperation === 'fetch-alphapose'
                      ? '取得中…'
                      : '取得'}
                  </button>
                )}
              </div>
            </li>
            <li className={setupStatus.motionBertReady ? 'completed' : ''}>
              <div className="ai-setup-step-header">
                <div>
                  <strong>5. MotionBERT本体を取得</strong>
                  <span>{setupStatus.motionBertPath}</span>
                  <span>公式リポジトリから取得します。</span>
                </div>
                {!setupStatus.motionBertReady && (
                  <button
                    type="button"
                    disabled={setupIsRunning}
                    onClick={() => runSetupOperation('fetch-motionbert')}
                  >
                    {pendingSetupOperation === 'fetch-motionbert'
                      ? '取得中…'
                      : '取得'}
                  </button>
                )}
              </div>
            </li>
          </ol>
          <p className="ai-environment-storage-note">
            本体の取得後に、各プロジェクトが配布する学習済みモデルを所定の場所へ配置します。
          </p>
        </section>
      )}

      {setupStatus?.alphaPoseReady && setupStatus.motionBertReady && (
        <section className="ai-environment-card ai-python-setup">
          <h3>学習済みモデルの配置</h3>
          <ol className="ai-setup-step-list">
            <li className={setupStatus.alphaPoseModelReady ? 'completed' : ''}>
              <div className="ai-setup-step-header">
                <div>
                  <strong>6. AlphaPoseモデルを配置</strong>
                  <span>{setupStatus.alphaPoseModelPath}</span>
                  <span>
                    公式配布ページからhalpe26_fast_res50_256x192.pthをダウンロードしてください。
                  </span>
                </div>
                {!setupStatus.alphaPoseModelReady && (
                  <div className="ai-setup-step-actions">
                    <button
                      type="button"
                      disabled={setupIsRunning}
                      onClick={() => openModelPage('alphapose')}
                    >
                      公式ページ
                    </button>
                    <button
                      type="button"
                      disabled={setupIsRunning}
                      onClick={() => installModel('alphapose')}
                    >
                      {pendingSetupOperation === 'install-alphapose-model'
                        ? '配置中…'
                        : 'ファイルを選択'}
                    </button>
                  </div>
                )}
              </div>
            </li>
            <li
              className={
                setupStatus.alphaPoseDetectorModelReady ? 'completed' : ''
              }
            >
              <div className="ai-setup-step-header">
                <div>
                  <strong>7. AlphaPose人物検出モデルを配置</strong>
                  <span>{setupStatus.alphaPoseDetectorModelPath}</span>
                  <span>
                    公式配布ページからyolov3-spp.weightsをダウンロードしてください。
                  </span>
                </div>
                {!setupStatus.alphaPoseDetectorModelReady && (
                  <div className="ai-setup-step-actions">
                    <button
                      type="button"
                      disabled={setupIsRunning}
                      onClick={() => openModelPage('alphapose-detector')}
                    >
                      公式ページ
                    </button>
                    <button
                      type="button"
                      disabled={setupIsRunning}
                      onClick={() => installModel('alphapose-detector')}
                    >
                      {pendingSetupOperation ===
                      'install-alphapose-detector-model'
                        ? '配置中…'
                        : 'ファイルを選択'}
                    </button>
                  </div>
                )}
              </div>
            </li>
            <li
              className={
                setupStatus.alphaPoseTrackerModelReady ? 'completed' : ''
              }
            >
              <div className="ai-setup-step-header">
                <div>
                  <strong>8. AlphaPose人物追跡モデルを配置</strong>
                  <span>{setupStatus.alphaPoseTrackerModelPath}</span>
                  <span>
                    公式配布ページから人物追跡用のReIDモデルをダウンロードしてください。
                  </span>
                </div>
                {!setupStatus.alphaPoseTrackerModelReady && (
                  <div className="ai-setup-step-actions">
                    <button
                      type="button"
                      disabled={setupIsRunning}
                      onClick={() => openModelPage('alphapose-tracker')}
                    >
                      公式ページ
                    </button>
                    <button
                      type="button"
                      disabled={setupIsRunning}
                      onClick={() => installModel('alphapose-tracker')}
                    >
                      {pendingSetupOperation ===
                      'install-alphapose-tracker-model'
                        ? '配置中…'
                        : 'ファイルを選択'}
                    </button>
                  </div>
                )}
              </div>
            </li>
            <li className={setupStatus.motionBertModelReady ? 'completed' : ''}>
              <div className="ai-setup-step-header">
                <div>
                  <strong>9. MotionBERTモデルを配置</strong>
                  <span>{setupStatus.motionBertModelPath}</span>
                  <span>
                    公式配布ページからbest_epoch.binをダウンロードしてください。配置時にSHA-256を検証します。
                  </span>
                </div>
                {!setupStatus.motionBertModelReady && (
                  <div className="ai-setup-step-actions">
                    <button
                      type="button"
                      disabled={setupIsRunning}
                      onClick={() => openModelPage('motionbert')}
                    >
                      公式ページ
                    </button>
                    <button
                      type="button"
                      disabled={setupIsRunning}
                      onClick={() => installModel('motionbert')}
                    >
                      {pendingSetupOperation === 'install-motionbert-model'
                        ? '配置中…'
                        : 'ファイルを選択'}
                    </button>
                  </div>
                )}
              </div>
            </li>
          </ol>
          <p className="ai-environment-storage-note">
            すべてのモデルの配置後に「AI APIを起動・再接続」を押すと、専用AI環境へ切り替わります。
          </p>
        </section>
      )}

      {setupStatus &&
        (setupStatus.message ||
          setupStatus.error ||
          setupStatus.logs.length > 0) && (
          <section className="ai-environment-card ai-setup-progress">
            <div className="ai-setup-progress-header">
              <h3>セットアップ状況</h3>
              {setupCanBeCancelled && (
                <div>
                  <span>処理中</span>
                  <button
                    type="button"
                    disabled={isCancellingSetup}
                    onClick={cancelSetupOperation}
                  >
                    {isCancellingSetup ? '中止中…' : '中止'}
                  </button>
                </div>
              )}
            </div>
            {setupStatus.message && <p>{setupStatus.message}</p>}
            {setupStatus.error && (
              <p className="ai-setup-progress-error" role="alert">
                {setupStatus.error}
              </p>
            )}
            {setupStatus.logs.length > 0 && (
              <details open={setupIsRunning}>
                <summary>実行ログ</summary>
                <pre>{setupStatus.logs.join('\n')}</pre>
              </details>
            )}
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
              const dedicatedState = dedicatedGroupState[group.id]
              const groupOk =
                group.checks.every((check) => check.ok) ||
                dedicatedState?.ready === true
              const groupPresentation = environmentGroupPresentation[group.id]
              const missingChecks = groupOk
                ? []
                : group.checks.filter((check) => !check.ok)
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
                    {dedicatedState ? (
                      <span>{dedicatedState.path}</span>
                    ) : (
                      missingChecks.map((check) => (
                        <span key={`${check.name}-${check.path ?? ''}`}>
                          {check.path ?? check.error ?? check.name}
                        </span>
                      ))
                    )}
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
          Python環境の準備後に、AlphaPose・MotionBERT本体とモデルをセットアップします。
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
