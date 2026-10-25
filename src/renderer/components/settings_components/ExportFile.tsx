import React from 'react'

interface SettingsProps {
  onSaveEAF: () => void
  onExportCSV: () => void
}

export const ExportFile: React.FC<SettingsProps> = ({
  onSaveEAF,
  onExportCSV
}) => {
  return (
    <div id="export-file">
      <section className="export-file-card">
        <div className="export-file-card-text">
          <h2>注釈を保存</h2>
          <p>現在の注釈をELANと互換性のあるEAF形式で保存します。</p>
        </div>
        <button className="primary-action" onClick={onSaveEAF}>
          EAFを保存
        </button>
      </section>
      <section className="export-file-card">
        <div className="export-file-card-text">
          <h2>注釈データを書き出す</h2>
          <p>表計算ソフトや解析処理で利用するため、CSV形式で出力します。</p>
        </div>
        <div className="export-file-actions">
          <button onClick={onExportCSV}>CSV出力</button>
        </div>
      </section>
      <p className="export-file-shortcut-note">
        Ctrl+Sで現在のEAFへ上書きし、Ctrl+Shift+Sで名前を付けて保存します。
      </p>
    </div>
  )
}

export default ExportFile
