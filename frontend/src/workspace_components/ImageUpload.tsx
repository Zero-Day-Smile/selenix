// workspace_components/ImageUpload.tsx
import { useState, useRef, type DragEvent } from 'react';

interface Props {
  label: string;
  files: File[];
  onFileChange: (files: File[]) => void;
  disabled?: boolean;
  previewUrl?: string | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ImageUpload({ label, files, onFileChange, disabled = false, previewUrl }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasMultiple = files.length >= 2;
  const singleFile = files.length === 1 ? files[0] : null;

  const handleDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isDragging) setIsDragging(true);
  };

  const handleDragEnter = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;
    const droppedFiles = Array.from(e.dataTransfer.files || []);
    if (droppedFiles.length > 0) {
      onFileChange(droppedFiles);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLLabelElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div className="bg-white border border-[#0E0E0E]/15 dark:bg-[#0E0E0E] dark:backdrop-blur-md dark:border-white/10 p-6 shadow-sm rounded-sm">
      <h3 className="text-xs font-bold tracking-wide uppercase mb-4 text-gray-800 dark:text-gray-200">{label}</h3>
      <label
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-label={`Upload container for ${label}`}
        className={`border-2 border-dashed rounded-sm h-48 flex flex-col items-center justify-center cursor-pointer transition-colors relative overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E0E0E] dark:focus-visible:ring-white ${
          isDragging
            ? 'border-[#0E0E0E] bg-[#0E0E0E]/10 dark:border-white dark:bg-white/10'
            : 'border-gray-300 dark:border-white/15 hover:border-[#0E0E0E]/60 dark:hover:border-white/60 bg-gray-50 dark:bg-black/20'
        } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onFileChange(Array.from(e.target.files || []))}
          disabled={disabled}
        />
        {isDragging ? (
          <div className="flex flex-col items-center gap-1 pointer-events-none">
            <span className="text-sm font-bold text-[#0E0E0E] dark:text-white">Drop files to upload</span>
            <span className="text-[10px] text-gray-400 font-mono">Release files here</span>
          </div>
        ) : hasMultiple ? (
          <div className="w-full max-h-full overflow-y-auto px-4 py-2 space-y-1 text-left">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[#0E0E0E] dark:text-white font-semibold mb-1">
              {files.length} files selected
            </div>
            {files.map((f, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs font-mono bg-black/5 dark:bg-white/5 px-2.5 py-1 rounded-sm border border-black/5 dark:border-white/5">
                <span className="truncate max-w-[200px] text-gray-800 dark:text-gray-200" title={f.name}>{f.name}</span>
                <span className="text-[10px] text-gray-500 shrink-0 ml-2">{formatFileSize(f.size)}</span>
              </div>
            ))}
          </div>
        ) : previewUrl ? (
          <img src={previewUrl} alt={`${label} preview`} className="object-contain max-h-full max-w-full" />
        ) : singleFile ? (
          <div className="flex flex-col items-center gap-1 px-4 text-center">
            <span className="font-mono text-xs text-gray-800 dark:text-gray-200 font-medium truncate max-w-full">{singleFile.name}</span>
            <span className="text-[10px] text-gray-500 font-mono">{formatFileSize(singleFile.size)}</span>
          </div>
        ) : (
          <span className="text-xs text-gray-500 font-medium">Click or drag &amp; drop to upload {label.toLowerCase()}</span>
        )}
      </label>
      <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400 font-sans italic">
        {label.toLowerCase().includes('reference')
          ? 'For LRO NAC PDS3 products with a detached label, select the .lbl file together with its .IMG file.'
          : 'For Chandrayaan-2 PDS4 products, select the .xml/.lbl label together with its .img file.'}
      </p>
    </div>
  );
}
