import { getBayerThreshold } from './bayer';

// Configuration interface for the dither engine
export interface DitherConfig {
  pixelSize: number;
  spacing: number;
  dotScale: number;
  levels: number;
  contrast: number;
  brightness: number;
  mouseX: number;
  mouseY: number;
  width: number;
  height: number;
  state: 'empty' | 'evaluating' | 'result';
}

// Color palettes based on CoolPath semantics
const COLORS = {
  GROUND: '#1e293b', // Deep graphite / slate 800
  ROUTE: '#0ea5e9', // Cyan-teal (primary)
  THERMAL: '#f59e0b', // Muted amber-orange
  NEUTRAL: '#94a3b8' // Slate 400
};

// We will use a procedural generator if no video is provided.
// To satisfy "PIN THE LEVELS", we'll just hardcode normalization since procedural values are predictable.
const MIN_LUMA = 0.05;
const MAX_LUMA = 0.95;

interface Dot {
  x: number;
  y: number;
  radius: number;
  color: string;
}

export class DitherEngine {
  private offscreen: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  private time: number = 0;

  constructor(width: number, height: number) {
    this.offscreen = document.createElement('canvas');
    this.offscreen.width = width;
    this.offscreen.height = height;
    this.offscreenCtx = this.offscreen.getContext('2d', { willReadFrequently: true })!;
  }

  public resize(width: number, height: number) {
    if (this.offscreen.width !== width || this.offscreen.height !== height) {
      this.offscreen.width = width;
      this.offscreen.height = height;
    }
  }

  // Generate a procedural source frame mimicking city network, route candidates, and thermal evidence
  private drawProceduralSource(ctx: CanvasRenderingContext2D, width: number, height: number, state: DitherConfig['state']) {
    ctx.fillStyle = '#000000'; // Base
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const t = this.time * 0.001;

    // Intensity multiplier based on state
    const intensity = state === 'evaluating' ? 1.5 : state === 'result' ? 0.3 : 0.8;

    // 1. City network (stable ground layer)
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      ctx.moveTo(0, (i * height) / 10 + Math.sin(i) * 20);
      ctx.lineTo(width, (i * height) / 10 + Math.cos(i) * 20);
      ctx.moveTo((i * width) / 10 + Math.sin(i) * 20, 0);
      ctx.lineTo((i * width) / 10 + Math.cos(i) * 20, height);
    }
    ctx.stroke();

    // 2. Route candidates (Cyan/Blue layer)
    ctx.strokeStyle = `rgba(0, 100, 255, ${0.5 * intensity})`;
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(cx - 200, cy + 100);
    ctx.quadraticCurveTo(cx, cy - 100 + Math.sin(t * 2) * 20, cx + 200, cy - 50);
    ctx.stroke();

    // Secondary route
    if (state === 'evaluating') {
      ctx.strokeStyle = `rgba(0, 80, 200, 0.4)`;
      ctx.beginPath();
      ctx.moveTo(cx - 200, cy + 100);
      ctx.quadraticCurveTo(cx - 50, cy + 150 + Math.cos(t * 3) * 30, cx + 200, cy - 50);
      ctx.stroke();
    }

    // 3. Thermal evidence (Red/Orange layer)
    const thermalGradient = ctx.createRadialGradient(
      cx + Math.cos(t) * 100, cy + Math.sin(t * 0.8) * 80, 0,
      cx + Math.cos(t) * 100, cy + Math.sin(t * 0.8) * 80, 150
    );
    thermalGradient.addColorStop(0, `rgba(255, 50, 0, ${0.8 * intensity})`);
    thermalGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = thermalGradient;
    ctx.fillRect(0, 0, width, height);

    // Minor thermal spot
    const thermalGradient2 = ctx.createRadialGradient(
      cx - 150 + Math.sin(t * 1.5) * 50, cy - 100 + Math.cos(t * 1.2) * 50, 0,
      cx - 150 + Math.sin(t * 1.5) * 50, cy - 100 + Math.cos(t * 1.2) * 50, 80
    );
    thermalGradient2.addColorStop(0, `rgba(255, 100, 0, ${0.6 * intensity})`);
    thermalGradient2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = thermalGradient2;
    ctx.fillRect(0, 0, width, height);
  }

  // Core dither processing loop
  public processFrame(outCtx: CanvasRenderingContext2D, config: DitherConfig, deltaTime: number) {
    this.time += deltaTime;
    
    // Scale down rendering based on pixelSize for performance and effect
    const dw = Math.ceil(config.width / config.pixelSize);
    const dh = Math.ceil(config.height / config.pixelSize);
    
    // Draw procedural source
    this.drawProceduralSource(this.offscreenCtx, dw, dh, config.state);
    
    // Read pixels
    const imgData = this.offscreenCtx.getImageData(0, 0, dw, dh);
    const data = imgData.data;

    // Bucket collections to reduce fillStyle changes
    const buckets: Record<string, Dot[]> = {
      [COLORS.GROUND]: [],
      [COLORS.ROUTE]: [],
      [COLORS.THERMAL]: [],
      [COLORS.NEUTRAL]: []
    };

    // Calculate pointer influence
    const pointerInfluenceRadius = config.width * 0.3;

    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const i = (y * dw + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Convert to luminance
        let luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;

        // Apply background floor
        luma = Math.max(luma, 0.02);

        // Normalize (pinned)
        luma = (luma - MIN_LUMA) / (MAX_LUMA - MIN_LUMA);
        luma = Math.max(0, Math.min(1, luma));

        // Apply contrast & brightness
        const c = (config.contrast / 100) + 1;
        luma = (luma - 0.5) * c + 0.5 + (config.brightness / 100);
        luma = Math.max(0, Math.min(1, luma));

        // Quantize levels
        const step = 1.0 / (config.levels - 1);
        const quantized = Math.round(luma / step) * step;

        // Bayer threshold check
        const threshold = getBayerThreshold(x, y);
        
        if (quantized > threshold * 0.5) { // Multiply by 0.5 to keep field airy
          // Calculate screen position
          let sx = x * config.pixelSize;
          let sy = y * config.pixelSize;

          // Pointer displacement
          if (config.mouseX > 0 && config.mouseY > 0) {
            const dx = sx - config.mouseX;
            const dy = sy - config.mouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < pointerInfluenceRadius) {
              const influence = Math.pow(1 - dist / pointerInfluenceRadius, 2); // Eased falloff
              sx += (dx / dist) * influence * 15;
              sy += (dy / dist) * influence * 15;
            }
          }

          const radius = (config.pixelSize / 2) * config.dotScale * Math.max(0.2, quantized);

          // Categorize color based on dominant channel in the source pixel
          let color = COLORS.GROUND;
          if (r > Math.max(g, b) + 20) {
            color = COLORS.THERMAL;
          } else if (b > Math.max(r, g) + 20) {
            color = COLORS.ROUTE;
          } else if (luma > 0.4) {
            color = COLORS.NEUTRAL;
          }

          buckets[color].push({ x: sx, y: sy, radius, color });
        }
      }
    }

    // Render by bucket
    outCtx.clearRect(0, 0, config.width, config.height);
    
    for (const [color, dots] of Object.entries(buckets)) {
      if (dots.length === 0) continue;
      
      outCtx.fillStyle = color;
      outCtx.beginPath();
      
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        outCtx.moveTo(d.x + d.radius, d.y);
        outCtx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
      }
      
      outCtx.fill();
    }
  }
}
