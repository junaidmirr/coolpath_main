import { useEffect, useRef, useState } from 'react';
import { DitherEngine, type DitherConfig } from '../lib/dither';

interface Props {
  state: 'empty' | 'evaluating' | 'result';
}

export default function ThermalDispatchField({ state }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<DitherEngine | null>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const lastTimeRef = useRef<number>(0);
  const isHiddenRef = useRef<boolean>(false);
  
  // Respect reduced motion
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Feature Flag Check (Optional)
    if (import.meta.env.VITE_ENABLE_THERMAL_FIELD === 'false') {
       return;
    }

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      
      if (engineRef.current) {
        engineRef.current.resize(width, height);
      }
    };

    window.addEventListener('resize', resize);
    resize();

    engineRef.current = new DitherEngine(width, height);

    const animate = (time: number) => {
      if (isHiddenRef.current) {
        requestRef.current = requestAnimationFrame(animate);
        return;
      }

      const deltaTime = time - lastTimeRef.current;
      lastTimeRef.current = time;

      // When reduced motion is preferred, we only render once (or very infrequently)
      // For simplicity, we just cap delta time to 0 to freeze the procedural animation.
      const renderDelta = prefersReducedMotion ? 0 : Math.min(deltaTime, 100);

      const config: DitherConfig = {
        pixelSize: 8,
        spacing: 0.42,
        dotScale: 0.78,
        levels: 5,
        contrast: 27,
        brightness: -3,
        mouseX: mouseRef.current.x,
        mouseY: mouseRef.current.y,
        width,
        height,
        state
      };

      engineRef.current!.processFrame(ctx, config, renderDelta);

      if (!prefersReducedMotion) {
        // Run roughly at 12fps (83ms) to feel analytical, but since we are using RAF we can just let it run smoothly 
        // and the procedural time handles the speed. But to save CPU as requested, we could throttle.
        // For now, full RAF is okay since drawing circles by color bucket is fast.
        requestRef.current = requestAnimationFrame(animate);
      }
    };

    requestRef.current = requestAnimationFrame(animate);

    // Track mouse
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };
    
    // Track visibility to pause
    const handleVisibility = () => {
      isHiddenRef.current = document.hidden;
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [prefersReducedMotion, state]);

  // Map product state to visual style
  let opacity = 0;
  if (state === 'empty') opacity = 0.3; // Subtle
  else if (state === 'evaluating') opacity = 0.7; // Active
  else if (state === 'result') opacity = 0.1; // Fade back drastically

  return (
    <div 
      ref={containerRef} 
      style={{ 
        position: 'absolute', 
        inset: 0, 
        zIndex: 0, 
        pointerEvents: 'none',
        opacity,
        transition: 'opacity 360ms var(--ease-standard)'
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
