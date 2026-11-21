import { useEffect, useRef } from 'react';
import { VISUAL_ASSETS } from '../config/assets';
import { formatMultiplier, getMultiplierTier } from '../engine/crashMath';
import type { RoundSnapshot } from '../types/game';

interface FlightStageProps {
  round: RoundSnapshot;
}

interface Star {
  x: number;
  y: number;
  size: number;
  speed: number;
  alpha: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

/**
 * Removes solid dark outer background from flyer.png via edge flood-fill
 * with soft alpha feathering so the character blends seamlessly into the
 * purple-dark space canvas without any square borders.
 */
function createTransparentSprite(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth || 256;
  const h = img.naturalHeight || 256;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  if (!octx) return off;

  octx.drawImage(img, 0, 0, w, h);
  const imgData = octx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // Sample background color from top-left pixel
  const bgR = data[0];
  const bgG = data[1];
  const bgB = data[2];

  // If image already has transparency at corners, return as-is
  if (data[3] < 20) return off;

  const total = w * h;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const colorDist = (idx4: number) => {
    const dr = data[idx4] - bgR;
    const dg = data[idx4 + 1] - bgG;
    const db = data[idx4 + 2] - bgB;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const hardThresh = 32;
  const softThresh = 56;

  const enqueue = (x: number, y: number) => {
    const p = y * w + x;
    if (visited[p]) return;
    const d = colorDist(p * 4);
    if (d <= softThresh) {
      visited[p] = 1;
      queue[tail++] = p;
    }
  };

  // Seed flood-fill from all 4 borders
  for (let x = 0; x < w; x++) {
    enqueue(x, 0);
    enqueue(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    enqueue(0, y);
    enqueue(w - 1, y);
  }

  while (head < tail) {
    const p = queue[head++];
    const idx4 = p * 4;
    const d = colorDist(idx4);

    if (d <= hardThresh) {
      data[idx4 + 3] = 0;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0) enqueue(x - 1, y);
      if (x < w - 1) enqueue(x + 1, y);
      if (y > 0) enqueue(x, y - 1);
      if (y < h - 1) enqueue(x, y + 1);
    } else if (d <= softThresh) {
      const alphaFactor = (d - hardThresh) / (softThresh - hardThresh);
      data[idx4 + 3] = Math.round(data[idx4 + 3] * alphaFactor);
    }
  }

  octx.putImageData(imgData, 0, 0);
  return off;
}

function drawJetpackHero(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  flameScale: number,
  customSprite: HTMLCanvasElement | HTMLImageElement | null,
  spriteSize = 104
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  if (customSprite) {
    const isCanvas = customSprite instanceof HTMLCanvasElement;
    const ready = isCanvas
      ? customSprite.width > 0
      : customSprite.complete && customSprite.naturalWidth > 0;
    if (ready) {
      if (flameScale > 0.7) {
        const aura = ctx.createRadialGradient(-6, 6, 8, -6, 6, spriteSize * 0.56);
        aura.addColorStop(0, 'rgba(251, 191, 36, 0.22)');
        aura.addColorStop(0.55, 'rgba(168, 85, 247, 0.14)');
        aura.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(-6, 6, spriteSize * 0.56, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.drawImage(customSprite, -spriteSize / 2, -spriteSize / 2, spriteSize, spriteSize);
      ctx.restore();
      return;
    }
  }

  // Subtle plasma speed aura behind hero
  if (flameScale > 0.7) {
    const aura = ctx.createRadialGradient(-4, 0, 6, -4, 0, 44);
    aura.addColorStop(0, 'rgba(168, 85, 247, 0.28)');
    aura.addColorStop(0.6, 'rgba(56, 189, 248, 0.12)');
    aura.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(-4, 0, 44, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dual animated plasma thruster flames
  if (flameScale > 0.05) {
    const flicker = 0.85 + Math.random() * 0.35;
    const len = 38 * flameScale * flicker;

    const drawFlame = (fy: number, scale: number) => {
      const fLen = len * scale;
      const flameGrad = ctx.createLinearGradient(-18, fy, -18 - fLen, fy + 6);
      flameGrad.addColorStop(0, '#ffffff');
      flameGrad.addColorStop(0.28, '#fde047');
      flameGrad.addColorStop(0.65, '#f97316');
      flameGrad.addColorStop(1, 'rgba(168, 85, 247, 0)');

      ctx.beginPath();
      ctx.moveTo(-17, fy - 4.5);
      ctx.quadraticCurveTo(-20 - fLen * 0.55, fy + 1, -18 - fLen, fy + 4);
      ctx.quadraticCurveTo(-20 - fLen * 0.5, fy + 7.5, -15, fy + 5.5);
      ctx.closePath();
      ctx.fillStyle = flameGrad;
      ctx.fill();
    };

    drawFlame(13, 1.0);
    drawFlame(6, 0.78);
  }

  // Flowing neon cape/ribbon
  ctx.fillStyle = 'rgba(192, 132, 252, 0.85)';
  ctx.beginPath();
  ctx.moveTo(-4, -9);
  ctx.quadraticCurveTo(-22, -16, -34, -8);
  ctx.quadraticCurveTo(-20, -4, -6, -1);
  ctx.closePath();
  ctx.fill();

  // Metallic twin-cylinder jetpack
  const packGrad = ctx.createLinearGradient(-24, -6, -8, 18);
  packGrad.addColorStop(0, '#38bdf8');
  packGrad.addColorStop(1, '#1d4ed8');
  ctx.fillStyle = packGrad;
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.roundRect(-23, -5, 16, 23, 6);
  ctx.fill();
  ctx.stroke();

  // Jetpack nozzle cap & glowing core
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(-24, 13, 10, 6, 2.5);
  ctx.fill();
  ctx.fillStyle = '#e0f2fe';
  ctx.fillRect(-20, 0, 9, 3.5);

  // Hero aerodynamic suit
  const suitGrad = ctx.createLinearGradient(-8, -14, 18, 16);
  suitGrad.addColorStop(0, '#a855f7');
  suitGrad.addColorStop(1, '#4c1d95');
  ctx.fillStyle = suitGrad;
  ctx.beginPath();
  ctx.roundRect(-8, -10, 22, 24, 9);
  ctx.fill();
  ctx.strokeStyle = '#d8b4fe';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Chest harness buckle
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(4, 0, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // Forward fist / arm
  ctx.fillStyle = '#c084fc';
  ctx.beginPath();
  ctx.roundRect(8, -6, 17, 7.5, 4);
  ctx.fill();

  // Trailing boot / legs
  ctx.fillStyle = '#1e1b4b';
  ctx.beginPath();
  ctx.roundRect(-15, 10, 15, 7, 3.5);
  ctx.fill();
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(-15, 11, 4, 5);

  // Aerodynamic helmet
  const helmGrad = ctx.createLinearGradient(-2, -26, 16, -6);
  helmGrad.addColorStop(0, '#ffffff');
  helmGrad.addColorStop(1, '#cbd5e1');
  ctx.fillStyle = helmGrad;
  ctx.beginPath();
  ctx.arc(6, -15, 11.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Glowing cyan visor
  const visorGrad = ctx.createLinearGradient(5, -20, 18, -11);
  visorGrad.addColorStop(0, '#22d3ee');
  visorGrad.addColorStop(1, '#2563eb');
  ctx.fillStyle = visorGrad;
  ctx.beginPath();
  ctx.roundRect(6, -20.5, 13, 8.5, 4);
  ctx.fill();

  // Visor reflection highlight
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.beginPath();
  ctx.ellipse(10.5, -17.8, 3.2, 1.3, -0.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function FlightStage({ round }: FlightStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const roundRef = useRef<RoundSnapshot>(round);

  const customCharSpriteRef = useRef<HTMLCanvasElement | HTMLImageElement | null>(null);
  const customBgImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  // Custom PNG preloading with automatic dark-background removal for flyer
  useEffect(() => {
    if (VISUAL_ASSETS.characterPng) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          customCharSpriteRef.current = createTransparentSprite(img);
        } catch {
          customCharSpriteRef.current = img;
        }
      };
      img.src = VISUAL_ASSETS.characterPng;
    }
    if (VISUAL_ASSETS.stageBgPng) {
      const img = new Image();
      img.src = VISUAL_ASSETS.stageBgPng;
      customBgImgRef.current = img;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = container.clientWidth;
    let height = container.clientHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // Starfield
    const stars: Star[] = Array.from({ length: 58 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 0.9 + Math.random() * 2,
      speed: 0.25 + Math.random() * 1.1,
      alpha: 0.25 + Math.random() * 0.75,
    }));

    const particles: Particle[] = [];
    let lastPhase = roundRef.current.phase;
    let crashAnimT = 0;
    let lastHeroPos = { x: width * 0.14, y: height * 0.78 };
    let rafId = 0;

    const render = (now: number) => {
      const cur = roundRef.current;

      // Detect phase transition to CRASHED to spawn burst particles
      if (cur.phase === 'CRASHED' && lastPhase !== 'CRASHED') {
        crashAnimT = 0;
        for (let i = 0; i < 28; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 1.6 + Math.random() * 5.2;
          particles.push({
            x: lastHeroPos.x,
            y: lastHeroPos.y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            life: 1,
            maxLife: 0.6 + Math.random() * 0.45,
            size: 2.5 + Math.random() * 4,
            color: i % 2 === 0 ? '#f43f5e' : '#fbbf24',
          });
        }
      }
      lastPhase = cur.phase;

      // Clear & background
      ctx.clearRect(0, 0, width, height);

      const bgImg = customBgImgRef.current;
      if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
        ctx.drawImage(bgImg, 0, 0, width, height);
      } else {
        const bgGrad = ctx.createRadialGradient(
          width * 0.65,
          height * 0.3,
          20,
          width * 0.5,
          height * 0.6,
          Math.max(width, height) * 0.9
        );
        if (cur.phase === 'CRASHED') {
          bgGrad.addColorStop(0, '#31102a');
          bgGrad.addColorStop(0.55, '#190c26');
          bgGrad.addColorStop(1, '#0b0818');
        } else {
          bgGrad.addColorStop(0, '#27144a');
          bgGrad.addColorStop(0.55, '#140d2b');
          bgGrad.addColorStop(1, '#0a0717');
        }
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // Subtle coordinate grid
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.09)';
      ctx.lineWidth = 1;
      const gridGap = width < 520 ? 44 : 60;
      const scrollOffset =
        cur.phase === 'FLYING' ? ((cur.elapsedFlightMs * 0.045) % gridGap) : 0;

      for (let gx = -scrollOffset; gx < width; gx += gridGap) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
        ctx.stroke();
      }
      for (let gy = height - 34; gy > 0; gy -= gridGap) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
        ctx.stroke();
      }

      // Parallax stars
      const speedMult =
        cur.phase === 'FLYING' ? 1.4 + Math.min(cur.multiplier * 0.45, 7) : 0.25;
      for (const s of stars) {
        s.x -= s.speed * speedMult;
        s.y += s.speed * speedMult * 0.22;
        if (s.x < -4) s.x = width + 4;
        if (s.y > height + 4) s.y = -4;

        ctx.fillStyle = `rgba(224, 231, 255, ${s.alpha * 0.75})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      const startX = Math.max(26, width * 0.07);
      const startY = height - Math.max(26, height * 0.11);

      if (cur.phase === 'WAITING') {
        const hoverY = startY - 18 + Math.sin(now * 0.004) * 5;
        lastHeroPos = { x: startX + 26, y: hoverY };

        // Subtle launch pad glow
        const padGrad = ctx.createRadialGradient(
          startX + 26,
          startY + 6,
          2,
          startX + 26,
          startY + 6,
          44
        );
        padGrad.addColorStop(0, 'rgba(168, 85, 247, 0.5)');
        padGrad.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = padGrad;
        ctx.beginPath();
        ctx.ellipse(startX + 26, startY + 6, 44, 12, 0, 0, Math.PI * 2);
        ctx.fill();

        drawJetpackHero(
          ctx,
          lastHeroPos.x,
          lastHeroPos.y,
          -0.08,
          0.55,
          customCharSpriteRef.current,
          width < 520 ? 86 : 110
        );
      } else if (cur.phase === 'FLYING') {
        const t = Math.min(1, cur.elapsedFlightMs / 7500);
        const eased = 1 - Math.pow(1 - t, 2.2);
        const bobX = t > 0.85 ? Math.sin(now * 0.0032) * 8 : 0;
        const bobY = t > 0.85 ? Math.cos(now * 0.0044) * 9 : 0;

        const targetX = startX + (width * 0.76 - startX) * eased + bobX;
        const targetY = startY - (startY - height * 0.24) * eased + bobY;
        lastHeroPos = { x: targetX, y: targetY };

        const ctrlX = startX + (targetX - startX) * 0.58;
        const ctrlY = startY - (startY - targetY) * 0.14;

        // Area under curve gradient
        const areaGrad = ctx.createLinearGradient(0, targetY, 0, startY);
        areaGrad.addColorStop(0, 'rgba(168, 85, 247, 0.32)');
        areaGrad.addColorStop(0.65, 'rgba(56, 189, 248, 0.12)');
        areaGrad.addColorStop(1, 'rgba(168, 85, 247, 0)');

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(ctrlX, ctrlY, targetX, targetY);
        ctx.lineTo(targetX, startY);
        ctx.closePath();
        ctx.fillStyle = areaGrad;
        ctx.fill();

        // Glowing flight path line
        const lineGrad = ctx.createLinearGradient(startX, startY, targetX, targetY);
        lineGrad.addColorStop(0, '#7c3aed');
        lineGrad.addColorStop(0.6, '#c084fc');
        lineGrad.addColorStop(1, '#38bdf8');

        ctx.save();
        ctx.shadowColor = '#a855f7';
        ctx.shadowBlur = 16;
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(ctrlX, ctrlY, targetX, targetY);
        ctx.stroke();
        ctx.restore();

        // Exhaust trail particles
        if (Math.random() < 0.75) {
          particles.push({
            x: targetX - 18,
            y: targetY + 12,
            vx: -2.2 - Math.random() * 2.4,
            vy: 0.7 + Math.random() * 1.4,
            life: 1,
            maxLife: 0.45 + Math.random() * 0.25,
            size: 2 + Math.random() * 3.5,
            color: Math.random() > 0.4 ? '#fbbf24' : '#c084fc',
          });
        }

        // Compute subtle tangent angle at curve end (flyer sprite already leans forward)
        const dx = targetX - ctrlX;
        const dy = targetY - ctrlY;
        const angle = Math.atan2(dy, dx) * 0.22;

        drawJetpackHero(
          ctx,
          targetX,
          targetY,
          angle,
          1.15,
          customCharSpriteRef.current,
          width < 520 ? 90 : 116
        );
      } else if (cur.phase === 'CRASHED') {
        crashAnimT += 0.045;
        if (crashAnimT < 1.2) {
          const flyOutX = lastHeroPos.x + crashAnimT * width * 0.55;
          const flyOutY = lastHeroPos.y - crashAnimT * height * 0.6;
          drawJetpackHero(
            ctx,
            flyOutX,
            flyOutY,
            -0.32,
            1.6,
            customCharSpriteRef.current,
            width < 520 ? 90 : 116
          );
        }
      }

      // Render & update particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.025 / p.maxLife;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  const tier = getMultiplierTier(round.multiplier);
  const phaseLabel =
    round.phase === 'WAITING'
      ? 'HAZIRLIQ'
      : round.phase === 'FLYING'
        ? 'UÇUŞ'
        : 'DAYANDI';

  return (
    <section className={`lj-stage phase-${round.phase.toLowerCase()}`} ref={containerRef}>
      <canvas ref={canvasRef} className="lj-stage-canvas" />

      {/* Top status badges inside stage */}
      <div className="lj-stage-hud">
        <span className="lj-round-badge">Raund #{round.roundNumber}</span>
        <span className={`lj-phase-pill phase-${round.phase.toLowerCase()}`}>
          <span className="lj-phase-dot" />
          {phaseLabel}
        </span>
      </div>

      {/* Center focal overlay */}
      <div className="lj-stage-center">
        {round.phase === 'WAITING' && (
          <div className="lj-waiting-box">
            <span className="lj-waiting-title">NÖVBƏTİ RAUND HAZIRLANIR</span>
            <div className="lj-countdown-num">
              {(round.countdownMs / 1000).toFixed(1)}s
            </div>
            <div className="lj-progress-track">
              <div
                className="lj-progress-fill"
                style={{ width: `${Math.max(0, Math.min(100, round.countdownProgress * 100))}%` }}
              />
            </div>
            <span className="lj-waiting-hint">Mərcinizi indi yerləşdirin</span>
          </div>
        )}

        {round.phase === 'FLYING' && (
          <div className={`lj-multiplier-display tier-${tier}`}>
            <span className="lj-multiplier-value">{formatMultiplier(round.multiplier)}</span>
          </div>
        )}

        {round.phase === 'CRASHED' && (
          <div className="lj-crashed-display">
            <span className="lj-crashed-badge">UÇUB GETDİ!</span>
            <span className="lj-multiplier-value is-crashed">
              {formatMultiplier(round.crashPoint ?? round.multiplier)}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
