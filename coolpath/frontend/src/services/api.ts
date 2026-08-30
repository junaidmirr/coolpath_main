import axios from 'axios';
import type { MissionRequest, MissionResponse } from '../types/mission';

const isDev = (import.meta as any).env?.DEV === true;

const ENV_API_URL: string | undefined =
  (import.meta as any).env?.VITE_API_BASE_URL ||
  (import.meta as any).env?.VITE_API_URL;

const CANDIDATE_PORTS = [8000, 8001, 8002, 8003, 8004, 8005, 8080, 5000];

let activeBaseUrl: string | null = ENV_API_URL || null;
let hasCompletedInitialWake = false;

export interface BackendStatus {
  online: boolean;
  url: string | null;
  port: number | null;
  demoMode?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const checkBackendHealth = async (): Promise<BackendStatus> => {
  // If in production, NEVER fallback to localhost.
  if (!isDev) {
    if (!ENV_API_URL) {
      console.error("Production environment missing VITE_API_BASE_URL.");
      return { online: false, url: null, port: null };
    }
    
    // Bounded wake strategy for Render cold starts
    const maxRetries = hasCompletedInitialWake ? 1 : 12; // up to 60s for first wake, then fast fail
    const retryInterval = 5000;
    const timeoutMs = hasCompletedInitialWake ? 2000 : 3500;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await axios.get(`${ENV_API_URL}/health`, { timeout: timeoutMs });
        if (res.data?.status === 'ok') {
          activeBaseUrl = ENV_API_URL;
          hasCompletedInitialWake = true;
          return { online: true, url: ENV_API_URL, port: 443, demoMode: res.data?.demo_mode };
        }
      } catch (err) {
        // Suppress and retry
      }
      if (i < maxRetries - 1) {
        await sleep(retryInterval);
      }
    }
    
    hasCompletedInitialWake = true;
    return { online: false, url: null, port: null };
  }

  // DEVELOPMENT MODE: probe known URL or fall back to candidate ports
  if (activeBaseUrl) {
    try {
      const res = await axios.get(`${activeBaseUrl}/health`, { timeout: 1500 });
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

  return { online: false, url: null, port: null };
};

export const getActiveBaseUrl = async (): Promise<string> => {
  if (activeBaseUrl) return activeBaseUrl;
  
  if (!isDev) {
      if (ENV_API_URL) return ENV_API_URL;
      throw new Error("Missing VITE_API_BASE_URL in production");
  }
  
  const status = await checkBackendHealth();
  if (status.online && status.url) {
    return status.url;
  }
  return 'http://localhost:8000'; // fallback in dev
};

export const planMission = async (request: MissionRequest): Promise<MissionResponse> => {
  const baseUrl = await getActiveBaseUrl();
  const response = await axios.post(`${baseUrl}/api/mission`, request, {
    timeout: 60000 // /api/mission requires a long operational timeout (1 minute)
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
