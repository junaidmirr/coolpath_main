import axios from 'axios';
import type { MissionRequest, MissionResponse } from '../types/mission';

// start.py writes the chosen backend port into coolpath/frontend/.env.local
// before Vite boots, so this value is always correct when launched via start.sh.
// Fallback port scan kicks in only when the frontend is started manually.
const ENV_API_URL: string | undefined =
  (import.meta as any).env?.VITE_API_BASE_URL ||
  (import.meta as any).env?.VITE_API_URL;

const CANDIDATE_PORTS = [8000, 8001, 8002, 8003, 8004, 8005, 8080, 5000];

// Module-level cache — starts with the env-injected URL if available.
let activeBaseUrl: string | null = ENV_API_URL || null;

export interface BackendStatus {
  online: boolean;
  url: string | null;
  port: number | null;
  demoMode?: boolean;
}

/**
 * Probes candidate ports to dynamically discover the active FastAPI backend.
 */
export const checkBackendHealth = async (): Promise<BackendStatus> => {
  // If we already have a known working URL, test it first
  if (activeBaseUrl) {
    try {
      const res = await axios.get(`${activeBaseUrl}/health`, { timeout: 1200 });
      if (res.data?.status === 'ok') {
        const portMatch = activeBaseUrl.match(/:(\d+)/);
        return {
          online: true,
          url: activeBaseUrl,
          port: portMatch ? parseInt(portMatch[1]) : 8000,
          demoMode: res.data?.demo_mode
        };
      }
    } catch {
      activeBaseUrl = null; // Cache invalidated, probe others
    }
  }

  // Probe all candidates in parallel
  const probePromises = CANDIDATE_PORTS.map(async (port) => {
    const url = `http://localhost:${port}`;
    try {
      const res = await axios.get(`${url}/health`, { timeout: 1500 });
      if (res.data?.status === 'ok') {
        return { url, port, demoMode: res.data?.demo_mode };
      }
    } catch {
      return null;
    }
    return null;
  });

  const results = await Promise.all(probePromises);
  const active = results.find(r => r !== null);

  if (active) {
    activeBaseUrl = active.url;
    return {
      online: true,
      url: active.url,
      port: active.port,
      demoMode: active.demoMode
    };
  }

  return {
    online: false,
    url: null,
    port: null
  };
};

export const getActiveBaseUrl = async (): Promise<string> => {
  if (activeBaseUrl) return activeBaseUrl;
  const status = await checkBackendHealth();
  if (status.online && status.url) {
    return status.url;
  }
  return 'http://localhost:8000'; // fallback
};

export const planMission = async (request: MissionRequest): Promise<MissionResponse> => {
  const baseUrl = await getActiveBaseUrl();
  const response = await axios.post(`${baseUrl}/api/mission`, request, {
    timeout: 120000 // Allow up to 2 mins for FortyGuard polling if needed
  });
  return response.data;
};

export const parseUserIntent = async (prompt: string) => {
  const baseUrl = await getActiveBaseUrl();
  const response = await axios.post(`${baseUrl}/api/parse-intent`, { prompt }, {
    timeout: 10000
  });
  return response.data;
};

