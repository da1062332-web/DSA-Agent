// apps/web/src/auth/FluidCanvas.tsx
// Volumetric 3D flowing fluid ribbon simulation in light corporate palette:
// Coral (#FF5522), Tangerine (#F89344), Ocean Blue (#3876BE), Navy (#215988), and Ice Blue (#B8D5E7).
// Wide fluid ribbons, real-time liquid wave undulation, and interactive mouse spring physics.
import React, { useEffect, useRef } from 'react';

interface FluidCanvasProps {
  interactive?: boolean;
  style?: React.CSSProperties;
}

export const FluidCanvas: React.FC<FluidCanvasProps> = ({ interactive = true, style }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    let height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

    // Mouse tracking with fluid spring physics
    const mouse = {
      x: width * 0.45,
      y: height * 0.45,
      targetX: width * 0.45,
      targetY: height * 0.45,
      vx: 0,
      vy: 0,
      influence: 0,
    };

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if (!interactive) return;
      const rect = canvas.getBoundingClientRect();
      const touch = 'touches' in e && e.touches.length > 0 ? e.touches[0] : null;
      const clientX = touch ? touch.clientX : (e as MouseEvent).clientX;
      const clientY = touch ? touch.clientY : (e as MouseEvent).clientY;
      mouse.targetX = clientX - rect.left;
      mouse.targetY = clientY - rect.top;
      mouse.influence = Math.min(mouse.influence + 0.1, 1);
    };

    const handlePointerLeave = () => {
      mouse.influence = 0;
    };

    window.addEventListener('mousemove', handlePointerMove, { passive: true });
    window.addEventListener('touchmove', handlePointerMove, { passive: true });
    window.addEventListener('mouseleave', handlePointerLeave);

    const handleResize = () => {
      if (!canvas.parentElement) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.parentElement.clientWidth;
      height = canvas.parentElement.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    // 16 Volumetric fluid ribbon bands
    const RIBBON_COUNT = 16;
    let time = 0;

    const render = () => {
      // Flowing, moving liquid velocity
      time += 0.012;

      // Elastic mouse smoothing
      const dx = mouse.targetX - mouse.x;
      const dy = mouse.targetY - mouse.y;
      mouse.vx = mouse.vx * 0.9 + dx * 0.035;
      mouse.vy = mouse.vy * 0.9 + dy * 0.035;
      mouse.x += mouse.vx;
      mouse.y += mouse.vy;
      mouse.influence *= 0.985;

      // Clean, luminous background fill
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      // Ambient liquid glow in background
      const glowWarm = ctx.createRadialGradient(
        width * 0.28,
        height * 0.22,
        30,
        width * 0.28,
        height * 0.22,
        width * 0.65,
      );
      glowWarm.addColorStop(0, 'rgba(248, 147, 68, 0.22)');
      glowWarm.addColorStop(0.5, 'rgba(255, 100, 47, 0.1)');
      glowWarm.addColorStop(1, 'rgba(248, 250, 252, 0)');
      ctx.fillStyle = glowWarm;
      ctx.fillRect(0, 0, width, height);

      const glowCool = ctx.createRadialGradient(
        width * 0.72,
        height * 0.65,
        30,
        width * 0.72,
        height * 0.65,
        width * 0.65,
      );
      glowCool.addColorStop(0, 'rgba(56, 118, 190, 0.2)');
      glowCool.addColorStop(0.55, 'rgba(184, 213, 231, 0.12)');
      glowCool.addColorStop(1, 'rgba(248, 250, 252, 0)');
      ctx.fillStyle = glowCool;
      ctx.fillRect(0, 0, width, height);

      ctx.save();

      // Render 16 Volumetric 3D ribbons with bezier curves
      for (let i = 0; i < RIBBON_COUNT; i++) {
        const ratio = i / (RIBBON_COUNT - 1); // 0 (warm Coral/Tangerine) to 1 (cool Ocean/Navy/Ice)
        const stripThickness = 28 + Math.sin(ratio * Math.PI) * 26; // 28px - 54px wide strips
        const spread = (i - RIBBON_COUNT * 0.5) * 24;

        // Mouse displacement calculation
        const mouseDistX = (mouse.x - width * 0.5) / width;
        const mouseDistY = (mouse.y - height * 0.5) / height;

        // Wave control coordinates for volumetric ribbons
        const startX = -width * 0.12;
        const startY = height * 0.18 + spread * 1.5 + Math.sin(time * 0.8 + i * 0.2) * 25;

        // Control point 1 (upper-mid sweep)
        const cp1x =
          width * 0.28 +
          Math.sin(time * 0.75 + i * 0.18) * 55 +
          mouseDistX * 90;
        const cp1y =
          height * (0.12 + ratio * 0.42) +
          spread * 2.2 +
          Math.cos(time * 0.9 + i * 0.22) * 65 +
          mouseDistY * 80;

        // Control point 2 (lower-mid sweep)
        const cp2x =
          width * 0.64 +
          Math.cos(time * 0.85 - i * 0.15) * 75 +
          mouseDistX * 110;
        const cp2y =
          height * (0.38 + ratio * 0.46) +
          spread * 1.9 +
          Math.sin(time * 1.05 + i * 0.24) * 75 +
          mouseDistY * 95;

        // End point
        const endX = width * 1.15;
        const endY =
          height * (0.62 + ratio * 0.35) +
          spread * 1.4 +
          Math.cos(time * 0.7 + i * 0.12) * 45;

        // 1. Draw solid filled 3D ribbon body
        ctx.beginPath();
        // Top boundary
        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
        // Bottom boundary
        ctx.lineTo(endX, endY + stripThickness);
        ctx.bezierCurveTo(
          cp2x,
          cp2y + stripThickness,
          cp1x,
          cp1y + stripThickness,
          startX,
          startY + stripThickness,
        );
        ctx.closePath();

        // Multi-stop liquid gradient across the ribbon length
        const ribbonGrad = ctx.createLinearGradient(startX, startY, endX, endY);

        if (ratio < 0.35) {
          // Top ribbons: Radiant Coral (#FF5522) to Tangerine (#F89344)
          const p = ratio / 0.35;
          ribbonGrad.addColorStop(0, `rgba(255, 85, 34, ${0.75 + p * 0.15})`);
          ribbonGrad.addColorStop(0.35, `rgba(248, 147, 68, 0.85)`);
          ribbonGrad.addColorStop(0.7, `rgba(255, 170, 70, 0.8)`);
          ribbonGrad.addColorStop(1, `rgba(255, 130, 45, 0.7)`);
        } else if (ratio < 0.7) {
          // Mid ribbons: Tangerine blending seamlessly into vibrant Ocean Blue (#3876BE)
          const p = (ratio - 0.35) / 0.35;
          ribbonGrad.addColorStop(0, `rgba(248, 147, 68, ${0.8 - p * 0.2})`);
          ribbonGrad.addColorStop(0.4, `rgba(56, 118, 190, ${0.75 + p * 0.1})`);
          ribbonGrad.addColorStop(0.8, `rgba(33, 89, 136, 0.85)`);
          ribbonGrad.addColorStop(1, `rgba(80, 150, 225, 0.75)`);
        } else {
          // Lower ribbons: Ocean Blue to Deep Corporate Navy (#215988) and Ice Blue (#B8D5E7)
          const p = (ratio - 0.7) / 0.3;
          ribbonGrad.addColorStop(0, `rgba(56, 118, 190, 0.8)`);
          ribbonGrad.addColorStop(0.45, `rgba(33, 89, 136, 0.9)`);
          ribbonGrad.addColorStop(0.8, `rgba(25, 72, 115, ${0.9 - p * 0.1})`);
          ribbonGrad.addColorStop(1, `rgba(184, 213, 231, 0.85)`);
        }

        ctx.fillStyle = ribbonGrad;
        ctx.fill();

        // 2. Glossy top rim specular highlight (giving high-end 3D silk / glass sheen)
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.55 + Math.sin(time * 1.4 + i) * 0.25})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // 3. Subtle bottom shadow crease for realistic volume
        ctx.beginPath();
        ctx.moveTo(startX, startY + stripThickness);
        ctx.bezierCurveTo(
          cp1x,
          cp1y + stripThickness,
          cp2x,
          cp2y + stripThickness,
          endX,
          endY + stripThickness,
        );
        ctx.strokeStyle = `rgba(10, 30, 60, ${0.15 + (1 - ratio) * 0.1})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('mouseleave', handlePointerLeave);
      window.removeEventListener('resize', handleResize);
    };
  }, [interactive]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        pointerEvents: 'none',
        ...style,
      }}
    />
  );
};
