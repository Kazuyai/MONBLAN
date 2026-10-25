import React from 'react'

interface SettingsProps {
  onSaveProject: () => void
  onExportCSV: () => void
  onExportEAF: () => void
}

export const ExportFile: React.FC<SettingsProps> = ({
  onSaveProject,
  onExportCSV,
  onExportEAF
}) => {
  return (
    <div id="export-file">
      <section className="export-file-card">
        <div className="export-file-card-text">
          <h2>プロジェクトを保存</h2>
          <p>
            現在の作業状態をJSON形式で保存します。保存後はCtrl+Sで上書きできます。
          </p>
        </div>
        <button className="primary-action" onClick={onSaveProject}>
          プロジェクトを保存
        </button>
      </section>
      <section className="export-file-card">
        <div className="export-file-card-text">
          <h2>注釈データを書き出す</h2>
          <p>解析や他ツールで利用するため、CSVまたはEAF形式で出力します。</p>
        </div>
        <div className="export-file-actions">
          <button onClick={onExportCSV}>CSV出力</button>
          <button onClick={onExportEAF}>EAF出力</button>
        </div>
      </section>
    </div>
  )
}

export default ExportFile
