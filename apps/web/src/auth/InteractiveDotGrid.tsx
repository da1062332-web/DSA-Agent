import React, { useEffect, useRef } from 'react';

interface InteractiveDotGridProps {
  dotSpacing?: number;
  baseRadius?: number;
  hoverRadius?: number;
  maxRepulsion?: number;
}

interface Dot {
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export const InteractiveDotGrid: React.FC<InteractiveDotGridProps> = ({
  dotSpacing = 24,
  baseRadius = 1.2,
  hoverRadius = 140,
  maxRepulsion = 10,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;
    let dpr = 1;

    let dots: Dot[] = [];
    const mouse = {
      x: -9999,
      y: -9999,
      active: false,
    };

    const initDots = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.scale(dpr, dpr);

      dots = [];
      const cols = Math.ceil(width / dotSpacing) + 1;
      const rows = Math.ceil(height / dotSpacing) + 1;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const bx = c * dotSpacing;
          const by = r * dotSpacing;
          dots.push({
            baseX: bx,
            baseY: by,
            x: bx,
            y: by,
            vx: 0,
            vy: 0,
          });
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    };

    const handleMouseLeave = () => {
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
    };

    const parent = canvas.parentElement;
    if (parent) {
      parent.addEventListener('mousemove', handleMouseMove);
      parent.addEventListener('mouseleave', handleMouseLeave);
    }

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && parent) {
      resizeObserver = new ResizeObserver(() => {
        initDots();
      });
      resizeObserver.observe(parent);
    }
    initDots();

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // 1. Soft Ambient Torch Glow around mouse
      if (mouse.active && mouse.x > 0 && mouse.y > 0) {
        const glow = ctx.createRadialGradient(
          mouse.x,
          mouse.y,
          0,
          mouse.x,
          mouse.y,
          hoverRadius * 1.3,
        );
        glow.addColorStop(0, 'rgba(37, 99, 235, 0.12)');
        glow.addColorStop(0.5, 'rgba(59, 130, 246, 0.05)');
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
      }

      // 2. Update and draw dots with magnetic repulsion & glow effect
      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        if (!dot) continue;

        // Calculate distance to mouse
        const dx = mouse.x - dot.baseX;
        const dy = mouse.y - dot.baseY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let targetX = dot.baseX;
        let targetY = dot.baseY;
        let proximity = 0;

        if (mouse.active && dist < hoverRadius && dist > 0) {
          proximity = 1 - dist / hoverRadius;
          // Magnetic push away from cursor
          const force = proximity * proximity * maxRepulsion;
          const angle = Math.atan2(dy, dx);
          targetX = dot.baseX - Math.cos(angle) * force;
          targetY = dot.baseY - Math.sin(angle) * force;
        }

        // Elastic spring interpolation back to target position
        dot.x += (targetX - dot.x) * 0.16;
        dot.y += (targetY - dot.y) * 0.16;

        // Dynamic size and color
        const radius = baseRadius + proximity * 1.8;

        ctx.beginPath();
        ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);

        if (proximity > 0) {
          // Luminous active dot
          const alpha = 0.2 + proximity * 0.8;
          ctx.fillStyle = `rgba(37, 99, 235, ${alpha.toFixed(2)})`;
          ctx.fill();

          // Outer halo for high proximity dots
          if (proximity > 0.45) {
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, radius + 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(96, 165, 250, ${(proximity * 0.3).toFixed(2)})`;
            ctx.fill();
          }
        } else {
          // Standard resting dot
          ctx.fillStyle = 'rgba(37, 99, 235, 0.16)';
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (parent) {
        parent.removeEventListener('mousemove', handleMouseMove);
        parent.removeEventListener('mouseleave', handleMouseLeave);
        resizeObserver?.disconnect();
      }
    };
  }, [dotSpacing, baseRadius, hoverRadius, maxRepulsion]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
};

export default InteractiveDotGrid;
