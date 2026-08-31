// workspace_components/ImageUpload.tsx
import React from 'react';

interface Props {
  label: string;
  file: File | null;
  onFileChange: (f: File | null) => void;
  disabled?: boolean;
  previewUrl?: string | null;
  // Real detached-label PDS3/PDS4 products need a label (.xml/.lbl) PLUS a
  // companion binary (.img/.IMG) selected together in the same picker --
  // called with the full selection whenever more than one file is picked,
  // so the caller can decide which is primary and store the rest.
  onMultipleFilesSelected?: (files: File[]) => void;
  companionFileNames?: string[];
}

export default function ImageUpload({
  label,
  file,
  onFileChange,
  disabled = false,
  previewUrl,
  onMultipleFilesSelected,
  companionFileNames = [],
}: Props) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 1 && onMultipleFilesSelected) {
      onMultipleFilesSelected(files);
    } else {
      onFileChange(files[0] || null);
    }
  };

  return (
    <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 p-6 shadow-sm rounded-sm">
      <h3 className="text-xs font-bold tracking-wide uppercase mb-4 text-gray-800 dark:text-gray-200">{label}</h3>
      <label
        className={`border-2 border-dashed border-gray-300 dark:border-white/15 rounded-sm h-48 flex flex-col items-center justify-center cursor-pointer hover:border-cyan-400/60 transition-colors bg-gray-50 dark:bg-black/20 relative overflow-hidden ${
          disabled ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        <input
          type="file"
          className="hidden"
          multiple
          onChange={handleChange}
          disabled={disabled}
        />
        {previewUrl ? (
          <img src={previewUrl} alt={label} className="object-contain max-h-full max-w-full" />
        ) : file ? (
          <span className="font-mono text-xs text-gray-800 dark:text-gray-200 font-medium">{file.name}</span>
        ) : (
          <span className="text-xs text-gray-500 font-medium">Click to upload {label.toLowerCase()}</span>
        )}
      </label>
      {companionFileNames.length > 0 && (
        <p className="text-[10px] text-gray-500 mt-2">
          + {companionFileNames.join(', ')} (companion {companionFileNames.length === 1 ? 'file' : 'files'} for this
          detached-label product)
        </p>
      )}
      <p className="text-[9px] text-gray-500 mt-1">
        For a detached-label PDS3/PDS4 product, select the label (.xml/.lbl) and its companion (.img/.IMG) together.
      </p>
    </div>
  );
}
