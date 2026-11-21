/**
 * Xüsusi qrafik elementlər üçün mərkəzləşdirilmiş konfiqurasiya.
 * `public/logo.png` (header loqosu) və `public/flyer.png` (uçan personaj) aktivdir.
 */
export interface VisualAssetsConfig {
  characterPng: string | null;
  stageBgPng: string | null;
  cardFramePng: string | null;
  logoPng: string | null;
}

export const VISUAL_ASSETS: VisualAssetsConfig = {
  characterPng: '/flyer.png',
  stageBgPng: null,
  cardFramePng: null,
  logoPng: '/logo.png',
};
