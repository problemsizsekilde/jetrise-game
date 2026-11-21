/**
 * Xüsusi PNG qrafik elementlər üçün mərkəzləşdirilmiş konfiqurasiya.
 * `public/assets/` qovluğuna şəkil əlavə edib aşağıdakı sahələrə yol yazdıqda
 * (məsələn: '/assets/character.png'), UI avtomatik olaraq həmin PNG-ni istifadə edəcək.
 * `null` olduqda daxili yüksək keyfiyyətli vektor/canvas qrafikası göstərilir.
 */
export interface VisualAssetsConfig {
  characterPng: string | null;
  stageBgPng: string | null;
  cardFramePng: string | null;
  logoPng: string | null;
}

export const VISUAL_ASSETS: VisualAssetsConfig = {
  characterPng: null, // Məsələn: '/assets/character.png'
  stageBgPng: null,   // Məsələn: '/assets/stage-bg.png'
  cardFramePng: null, // Məsələn: '/assets/card-frame.png'
  logoPng: null,      // Məsələn: '/assets/logo.png'
};
