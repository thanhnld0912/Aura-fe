import React, { useEffect, useRef, useState } from 'react';
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DESCRIPTION_LENGTH,
  formatFileSize,
  imageProblem,
} from '../../lib/image';

/**
 * Photo logging.
 *
 * The photo goes to **AURA**, which calls the vision model server-side and answers
 * with the same reviewable draft a description produces. Nothing here looks at the
 * image: no canvas, no decoding, no classification, no provider key. This component
 * picks a file, shows it back, and hands it to `POST /api/meals/analyze-image`.
 *
 * The preview is an object URL, which is a handle the browser holds open until it is
 * revoked. It is created and released here, keyed on the file, so switching photos or
 * closing the composer does not leak one.
 *
 * `capture="environment"` asks a phone for the rear camera and is ignored on desktop,
 * where the same input opens the file picker — one control for "take" and "choose"
 * rather than two that do the same thing.
 */

export interface PhotoModeProps {
  file: File | null;
  note: string;
  busy: boolean;
  /** True once a draft is on screen, so the button says what a second press would do. */
  analyzed: boolean;
  onPick: (file: File | null) => void;
  onNoteChange: (note: string) => void;
  onAnalyze: () => void;
}

export const PhotoMode: React.FC<PhotoModeProps> = ({
  file,
  note,
  busy,
  analyzed,
  onPick,
  onNoteChange,
  onAnalyze,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /** Refused before sending — a wrong type or an over-large file. Not a server error. */
  const [rejected, setRejected] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFiles = (files: FileList | null): void => {
    const chosen = files?.[0] ?? null;
    if (!chosen) return;

    const problem = imageProblem(chosen);
    if (problem) {
      // Screened here so it does not cost one of the twenty vision calls a day.
      setRejected(problem);
      onPick(null);
      return;
    }
    setRejected(null);
    onPick(chosen);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-[#faf2ec] p-4 sm:p-5 border border-[#eee7e1]/80 space-y-3">
        <input
          ref={inputRef}
          id="meal-photo"
          type="file"
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            handleFiles(event.target.files);
            // Lets the same file be chosen again after it was cleared.
            event.target.value = '';
          }}
        />

        {previewUrl && file ? (
          <div className="space-y-3">
            <div className="relative rounded-2xl overflow-hidden border border-[#eee7e1] bg-white">
              <img
                src={previewUrl}
                alt="The meal you are about to log"
                className="w-full max-h-72 object-contain"
              />
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-[#56423b] min-w-0 truncate">
                {file.name} · <span className="text-[#8a726a]">{formatFileSize(file.size)}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-full bg-white border border-[#eee7e1] text-xs font-semibold text-[#56423b] hover:border-[#9f4118]/40 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  Choose another
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRejected(null);
                    onPick(null);
                  }}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold text-[#93000a] hover:bg-[#ffdad6]/40 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-2xl border-2 border-dashed border-[#eee7e1] bg-white/60 hover:border-[#ff8a5b] hover:bg-white transition-colors p-6 sm:p-8 text-center"
          >
            <div className="w-14 h-14 rounded-full bg-white text-[#9f4118] flex items-center justify-center shadow-xs mx-auto">
              <span className="material-symbols-outlined text-[28px]">photo_camera</span>
            </div>
            <span className="block text-sm font-bold text-[#1e1b17] mt-3">
              Take or choose a photo
            </span>
            <span className="block text-xs text-[#56423b] mt-1">
              JPEG, PNG or WebP, up to {formatFileSize(MAX_IMAGE_BYTES)}
            </span>
          </button>
        )}

        {rejected && (
          <p role="alert" className="text-xs text-[#93000a]">
            {rejected}
          </p>
        )}

        <div className="space-y-1.5">
          <label htmlFor="photo-note" className="block text-xs font-semibold text-[#56423b]">
            Anything AURA should know? <span className="text-[#8a726a]">(optional)</span>
          </label>
          <input
            id="photo-note"
            type="text"
            value={note}
            maxLength={MAX_IMAGE_DESCRIPTION_LENGTH}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="phở bò tái, bát nhỏ"
            className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#eee7e1] text-sm text-[#1e1b17] placeholder:text-[#bda99f] focus:outline-none focus:border-[#ff8a5b] transition-colors"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={onAnalyze}
        disabled={!file || busy}
        className="w-full py-3 px-6 rounded-full bg-[#9f4118] text-white font-bold text-sm hover:bg-[#ff8a5b] disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
        <span>{analyzed ? 'Read the photo again' : 'Read the photo'}</span>
      </button>

      <p className="text-[11px] text-[#8a726a] leading-relaxed text-center">
        Your photo is sent to AURA, analysed, and never stored. Location and other
        metadata are stripped before it is read.
      </p>
    </div>
  );
};
