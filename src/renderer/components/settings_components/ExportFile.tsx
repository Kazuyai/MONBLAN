import React from 'react';

interface SettingsProps {
  onExportCSV: () => void;
}

export const ExportFile: React.FC<SettingsProps> = ({
    onExportCSV 
}) => {
  return (
    <div>
      <button onClick={onExportCSV}>csv出力</button>
    </div>
  );
};

export default ExportFile;
