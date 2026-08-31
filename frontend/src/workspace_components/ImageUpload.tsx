// workspace_components/ImageUpload.tsx
import React from 'react';

interface Props {
  label: string;
  file: File | null;
  onFileChange: (f: File | null) => void;
  disabled?: boolean;
  previewUrl?: string | null;
}

export default function ImageUpload({ label, file, onFileChange, disabled = false, previewUrl }: Props) {
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
          accept="image/*"
          onChange={(e) => onFileChange(e.target.files?.[0] || null)}
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
    </div>
  );
}