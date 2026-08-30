import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MissionRequest, MissionResponse } from '../types/mission';

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

export const NGROK_BACKEND_URL =
  trimTrailingSlash(process.env.EXPO_PUBLIC_NGROK_BACKEND_URL || 'https://sheldon-unexcerpted-overwillingly.ngrok-free.dev');

export const GCP_CLOUD_RUN_URL =
  trimTrailingSlash(process.env.EXPO_PUBLIC_GCP_BACKEND_URL || 'https://coolpath-806112833144.europe-west1.run.app');

const CANDIDATE_HOSTS = [
  NGROK_BACKEND_URL,      // Primary Default: Ngrok Tunnel
  GCP_CLOUD_RUN_URL,      // Fallback: GCP Cloud Run
  'http://10.0.2.2:8000', // Local Android Emulator
  'http://localhost:8000', // Local iOS Simulator / Web
  'http://127.0.0.1:8000',
];

export const COMMON_HEADERS = {
  'ngrok-skip-browser-warning': 'true',
};

let activeBaseUrl: string | null = null;

export const setCustomBackendUrl = async (url: string | null) => {
  if (url) {
    const trimmed = trimTrailingSlash(url);
    await AsyncStorage.setItem('@custom_backend_url', trimmed);
    activeBaseUrl = trimmed; // Override immediately
  } else {
    await AsyncStorage.removeItem('@custom_backend_url');
    activeBaseUrl = null;
  }
};

export const getCustomBackendUrl = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem('@custom_backend_url');
  } catch {
    return null;
  }
};

export interface BackendStatus {
  online: boolean;
  url: string | null;
  demoMode?: boolean;
  isRender?: boolean;
  isGcp?: boolean;
  isNgrok?: boolean;
  serverName?: string;
  isCustom?: boolean;
}

function determineServerName(url: string, isCustom: boolean = false): { serverName: string; isRender: boolean; isGcp: boolean; isNgrok: boolean; isCustom: boolean } {
  if (isCustom) {
    return { serverName: 'Custom Backend', isRender: false, isGcp: false, isNgrok: false, isCustom: true };
  } else if (url.includes('ngrok-free.dev') || url.includes('ngrok.io')) {
    return { serverName: 'Ngrok Tunnel', isRender: false, isGcp: false, isNgrok: true, isCustom: false };
  } else if (url.includes('onrender.com')) {
    return { serverName: 'Render Cloud', isRender: true, isGcp: false, isNgrok: false, isCustom: false };
  } else if (url.includes('run.app')) {
    return { serverName: 'GCP Cloud Run', isRender: false, isGcp: true, isNgrok: false, isCustom: false };
  } else {
    return { serverName: 'Local Server', isRender: false, isGcp: false, isNgrok: false, isCustom: false };
  }
}

export const checkBackendHealth = async (): Promise<BackendStatus> => {
  const customUrl = await getCustomBackendUrl();
  
  if (activeBaseUrl) {
    try {
      const res = await axios.get(`${activeBaseUrl}/health`, {
        timeout: 6000,
        headers: COMMON_HEADERS,
      });
      if (res.data?.status === 'ok') {
        const info = determineServerName(activeBaseUrl, activeBaseUrl === customUrl);
        return {
          online: true,
          url: activeBaseUrl,
          demoMode: res.data?.demo_mode,
          ...info,
        };
      }
    } catch {
      activeBaseUrl = null;
    }
  }

  if (customUrl) {
    try {
      const res = await axios.get(`${customUrl}/health`, {
        timeout: 6000,
        headers: COMMON_HEADERS,
      });
      if (res.data?.status === 'ok') {
        activeBaseUrl = customUrl;
        const info = determineServerName(customUrl, true);
        return {
          online: true,
          url: customUrl,
          demoMode: res.data?.demo_mode,
          ...info,
        };
      }
    } catch {
      // Custom URL failed, fallback to CANDIDATE_HOSTS
    }
  }

  for (const host of CANDIDATE_HOSTS) {
    try {
      const res = await axios.get(`${host}/health`, {
        timeout: 6000,
        headers: COMMON_HEADERS,
      });
      if (res.data?.status === 'ok') {
        activeBaseUrl = host;
        const info = determineServerName(host);
        return {
          online: true,
          url: host,
          demoMode: res.data?.demo_mode,
          ...info,
        };
      }
    } catch {
      continue;
    }
  }

  return { online: false, url: null, serverName: 'Offline' };
};

export const resetActiveBaseUrl = () => {
  activeBaseUrl = null;
};

export const getActiveBaseUrl = async (): Promise<string> => {
  if (activeBaseUrl) return activeBaseUrl;
  const status = await checkBackendHealth();
  return status.url || NGROK_BACKEND_URL;
};

const normalizeMissionResponse = (data: MissionResponse): MissionResponse => {
  if (data.route_options?.length || !data.routes) {
    return data;
  }

  const routeOptions = [];
  if (data.routes.fastest?.length > 1) {
    routeOptions.push({
      id: 'fastest',
      name: 'Direct Fastest',
      tag: data.recommended_action?.route_id === 'fastest' ? 'Recommended' : 'Fastest',
      travel_minutes: data.comparison?.fastest?.travel_minutes || 0,
      avg_temp_c: 33.5,
      thermal_exposure: data.comparison?.fastest?.thermal_exposure || 0,
      thermal_reduction_percent: 0,
      coordinates: data.routes.fastest,
      explanation: data.explanation || '',
      is_recommended: data.recommended_action?.route_id === 'fastest',
    });
  }

  if (data.routes.recommended?.length > 1) {
    const isDuplicate =
      JSON.stringify(data.routes.recommended) === JSON.stringify(data.routes.fastest);
    if (!isDuplicate) {
      routeOptions.push({
        id:
          data.recommended_action?.route_id &&
          data.recommended_action.route_id !== 'fastest'
            ? data.recommended_action.route_id
            : 'recommended',
        name: 'CoolPath Route',
        tag: 'Recommended',
        travel_minutes: data.comparison?.recommended?.travel_minutes || 0,
        avg_temp_c: 31.8,
        thermal_exposure: data.comparison?.recommended?.thermal_exposure || 0,
        thermal_reduction_percent: data.thermal_reduction_percent || 0,
        coordinates: data.routes.recommended,
        explanation: data.explanation || '',
        is_recommended: true,
      });
    }
  }

  return { ...data, route_options: routeOptions };
};

export const planMission = async (request: MissionRequest): Promise<MissionResponse> => {
  const baseUrl = await getActiveBaseUrl();
  try {
    const response = await axios.post(`${baseUrl}/api/mission`, request, {
      timeout: 120000,
      headers: COMMON_HEADERS,
    });
    return normalizeMissionResponse(response.data);
  } catch (error: any) {
    const message =
      error.response?.data?.detail?.message ||
      error.response?.data?.detail ||
      error.message ||
      'Route planning failed';
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
};

export const parseUserIntent = async (prompt: string) => {
  const baseUrl = await getActiveBaseUrl();
  try {
    const response = await axios.post(
      `${baseUrl}/api/parse-intent`,
      { prompt },
      {
        timeout: 15000,
        headers: COMMON_HEADERS,
      }
    );
    return response.data;
  } catch (error: any) {
    const message =
      error.response?.data?.detail?.message ||
      error.response?.data?.detail ||
      error.message ||
      'Intent parsing failed';
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
};

export const submitRouteFeedback = async (
  routeType: string,
  satisfied: boolean,
  context: any = {}
): Promise<{ status: string; shade_preference_percentage: number; new_predicted_satisfaction?: number }> => {
  const baseUrl = await getActiveBaseUrl();
  try {
    const response = await axios.post(
      `${baseUrl}/api/feedback`,
      { route_type: routeType, satisfied, context },
      { timeout: 10000, headers: COMMON_HEADERS }
    );
    return response.data;
  } catch (error: any) {
    console.warn('[Feedback API notice]', error.message);
    return { status: 'fallback', shade_preference_percentage: 65.0 };
  }
};

export const fetchMLStats = async (): Promise<{ status: string; shade_preference_percentage: number; history: any[]; is_bootstrapped: boolean }> => {
  const baseUrl = await getActiveBaseUrl();
  try {
    const response = await axios.get(`${baseUrl}/api/ml/stats`, {
      timeout: 8000,
      headers: COMMON_HEADERS,
    });
    return response.data;
  } catch (error: any) {
    return { status: 'offline', shade_preference_percentage: 65.0, history: [], is_bootstrapped: true };
  }
};

export interface SmartSearchResultItem {
  id: string;
  place_name: string;
  short_name: string;
  lat: number;
  lng: number;
  distance_km: number;
  ring: string;
  relevance_score?: number;
  badge_label?: string;
  reasoning?: string;
}

export const fetchSmartSearchSuggestions = async (
  query: string,
  originLat: number,
  originLng: number
): Promise<SmartSearchResultItem[]> => {
  if (!query || query.trim().length < 2) return [];
  try {
    const baseUrl = await getActiveBaseUrl();
    const response = await axios.post(
      `${baseUrl}/api/smart-search`,
      { query: query.trim(), origin_lat: originLat, origin_lng: originLng },
      { timeout: 8000, headers: COMMON_HEADERS }
    );
    if (response.data && Array.isArray(response.data.results)) {
      return response.data.results;
    }
    return [];
  } catch (error: any) {
    console.warn('[SmartSearch API notice]', error.message);
    return [];
  }
};

