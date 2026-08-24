import * as FileSystem from 'expo-file-system';
import type { Coordinate, MissionResponse, ActivityType, PaceType, PlanningMode } from '../types/mission';

export interface HistoryItem {
  id: string;
  timestamp: number;
  dateStr: string;
  originText: string;
  destText: string;
  originCoord: Coordinate;
  destCoord: Coordinate;
  activity: ActivityType;
  pace: PaceType;
  planningMode: PlanningMode;
  response: MissionResponse;
  selectedRouteId: string;
}

const HISTORY_FILE_PATH = `${FileSystem.documentDirectory}coolpath_route_history.json`;
let inMemoryHistory: HistoryItem[] = [];

export async function loadRouteHistory(): Promise<HistoryItem[]> {
  try {
    const info = await FileSystem.getInfoAsync(HISTORY_FILE_PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(HISTORY_FILE_PATH);
      if (raw) {
        const parsed = JSON.parse(raw) as HistoryItem[];
        inMemoryHistory = parsed;
        return parsed;
      }
    }
  } catch (e) {
    console.warn('FileSystem load history warning:', e);
  }
  return inMemoryHistory;
}

export async function saveRouteHistory(item: HistoryItem): Promise<HistoryItem[]> {
  const filtered = inMemoryHistory.filter((h) => h.id !== item.id);
  inMemoryHistory = [item, ...filtered].slice(0, 30);
  try {
    await FileSystem.writeAsStringAsync(HISTORY_FILE_PATH, JSON.stringify(inMemoryHistory));
  } catch (e) {
    console.warn('FileSystem save history warning:', e);
  }
  return inMemoryHistory;
}

export async function clearRouteHistory(): Promise<void> {
  inMemoryHistory = [];
  try {
    const info = await FileSystem.getInfoAsync(HISTORY_FILE_PATH);
    if (info.exists) {
      await FileSystem.deleteAsync(HISTORY_FILE_PATH, { idempotent: true });
    }
  } catch (e) {
    console.warn('FileSystem clear history warning:', e);
  }
}
