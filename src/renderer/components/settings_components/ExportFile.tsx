import React from 'react'

interface SettingsProps {
  onExportCSV: () => void
  onExportEAF: () => void
}

export const ExportFile: React.FC<SettingsProps> = ({
  onExportCSV,
  onExportEAF
}) => {
  return (
    <div>
      <button onClick={onExportCSV}>csv出力</button>
      <button onClick={onExportEAF}>eaf出力</button>
    </div>
  )
}

export default ExportFile
