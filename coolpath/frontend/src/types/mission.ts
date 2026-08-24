export interface Coordinate {
    lat: number;
    lng: number;
}

export type ActivityType = 'walking' | 'running' | 'biking' | 'driving';
export type PaceType = 'slow' | 'normal' | 'fast';
export type PlanningMode = 'instant' | 'scheduled';

export interface MissionRequest {
    origin: Coordinate;
    destination: Coordinate;
    departure_time?: string;
    deadline?: string;
    planning_mode?: PlanningMode;
    deadline_minutes?: number;
    activity?: ActivityType;
    pace?: PaceType;
    prompt?: string;
    special_tags?: string[];
}

export interface RouteOption {
    id: string;
    name: string;
    tag: string;
    travel_minutes: number;
    avg_temp_c: number;
    thermal_exposure: number;
    thermal_reduction_percent: number;
    coordinates: number[][];
    explanation: string;
    is_recommended: boolean;
}

export interface GeminiBriefing {
    headline: string;
    narrative: string;
    health_alert: string;
    timing_advice: string;
}

export interface EnvSummary {
    heat_index_c?: number;
    apparent_temp_c?: number;
    wet_bulb_temp_c?: number;
    relative_humidity_pct?: number;
    us_aqi?: number;
    pm25?: number;
    ozone_o3_ppb?: number;
    ghi_solar_w_m2?: number;
    air_quality_level?: string;
    solar_status?: string;
}

export interface ParsedIntent {
    activity: ActivityType;
    pace: PaceType;
    origin_query?: string;
    destination_query?: string;
    deadline_minutes?: number;
    thermal_sensitivity: number;
    special_profile_tags: string[];
    summary: string;
}

export interface MissionResponse {
    decision: string;
    planning_mode?: PlanningMode;
    wait_minutes: number;
    optimal_departure_time?: string;
    activity?: string;
    recommended_action: {
        route_id: string;
        departure_offset_minutes: number;
        pace: string;
    };
    comparison: {
        fastest: { travel_minutes: number; thermal_exposure: number };
        recommended: { travel_minutes: number; travel_time_minutes?: number; thermal_exposure: number };
    };
    thermal_reduction_percent: number;
    routes: {
        fastest: number[][];
        recommended: number[][];
    };
    route_options?: RouteOption[];
    gemini_briefing?: GeminiBriefing;
    env_summary?: EnvSummary;
    parsed_profile_tags?: string[];
    explanation: string;
}
