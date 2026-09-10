import React from 'react';

/**
 * Photo logging, deliberately inert.
 *
 * The tile stays because it describes where the product is going, but nothing behind
 * it exists yet: `POST /api/meals/analyze-image`, the storage bucket and the vision
 * output schema all arrive with Phase 4. There is no file input and no submit path,
 * so there is nothing here that could send an image anywhere or produce a number.
 */
export const PhotoMode: React.FC = () => (
  <div className="rounded-2xl bg-[#faf2ec] border border-[#eee7e1]/80 p-6 sm:p-8 text-center">
    <div className="w-14 h-14 rounded-full bg-white text-[#9f4118] flex items-center justify-center shadow-xs mx-auto">
      <span className="material-symbols-outlined text-[28px]">photo_camera</span>
    </div>
    <p className="text-sm font-bold text-[#1e1b17] mt-3">Photo logging is coming soon</p>
    <p className="text-xs text-[#56423b] mt-1 max-w-sm mx-auto leading-relaxed">
      AURA will estimate ingredients from a photo once the vision model is in place.
      Until then, <span className="font-semibold text-[#9f4118]">Tell AURA</span> or{' '}
      <span className="font-semibold text-[#2b6952]">Quick add</span> will log your meal
      with real numbers.
    </p>
  </div>
);
