import React from 'react'

interface SettingsProps {
  onExportProjectJson: () => void
  onExportCSV: () => void
  onExportEAF: () => void
}

export const ExportFile: React.FC<SettingsProps> = ({
  onExportProjectJson,
  onExportCSV,
  onExportEAF
}) => {
  return (
    <div>
      <button onClick={onExportProjectJson}>プロジェクトを保存</button>
      <button onClick={onExportCSV}>csv出力</button>
      <button onClick={onExportEAF}>eaf出力</button>
    </div>
  )
}

export default ExportFile
