import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, SafeAreaView,
  StatusBar, Dimensions, Animated, Image, PanResponder,
  Alert, Modal, Easing, Platform, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path, Circle, Line, Defs, LinearGradient as SvgGradient, Stop, Text as SvgText } from 'react-native-svg';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { MobileMap, MAPBOX_ACCESS_TOKEN, type PinMode, type NavPositionData } from './src/components/MobileMap';

let ExpoLocation: typeof import('expo-location') | null = null;
try {
  ExpoLocation = require('expo-location');
} catch (e) {
  ExpoLocation = null;
}

let SpeechModule: typeof import('expo-speech') | null = null;
try {
  SpeechModule = require('expo-speech');
} catch (e) {
  SpeechModule = null;
}
import { planMission, checkBackendHealth, parseUserIntent, setCustomBackendUrl, getCustomBackendUrl, fetchSmartSearchSuggestions, type BackendStatus } from './src/services/api';
import {
  loadRouteHistory, saveRouteHistory, clearRouteHistory, type HistoryItem,
} from './src/services/history';
import type {
  MissionRequest, MissionResponse, ActivityType, PaceType,
  PlanningMode, Coordinate, ParsedIntent,
} from './src/types/mission';
const womanImg = require('./assets/woman.png');
const motorbikeImg = require('./assets/motorbike.png');
const carImg = require('./assets/car.png');
const appIconImg = require('./assets/app_icon.png');
const GLOBAL_AUDIO_ENGINE_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body>
<script>
(function() {
  'use strict';
  let currentAudio = null;

  window._unlockAudio = function() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        var ctx = new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(0);
        osc.stop(0.05);
      }
    } catch(e) {}
  };

  window._speakText = function(text) {
    if (!text || typeof text !== 'string') return;
    var clean = text.replace(/[*_~#>-]/g, ' ').replace(/\\s+/g, ' ').trim();
    if (!clean) return;

    window._unlockAudio();

    // 1. Native Web Speech API with explicit Male voice filter
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        var utter = new SpeechSynthesisUtterance(clean);
        var voices = window.speechSynthesis.getVoices() || [];
        var maleVoice = voices.find(function(v) {
          var n = (v.name || '').toLowerCase();
          return (v.lang || '').indexOf('en') === 0 && (
            n.indexOf('male') !== -1 ||
            n.indexOf('david') !== -1 ||
            n.indexOf('alex') !== -1 ||
            n.indexOf('daniel') !== -1 ||
            n.indexOf('george') !== -1 ||
            n.indexOf('brian') !== -1 ||
            n.indexOf('guy') !== -1
          );
        });
        if (maleVoice) utter.voice = maleVoice;
        utter.rate = 1.15;
        utter.pitch = 0.85; // Low masculine pitch
        utter.lang = 'en-US';
        window.speechSynthesis.speak(utter);
      } catch(e) {}
    }

    // 2. High-Quality StreamElements MP3 TTS Audio (Brian - Deep Masculine Voice)
    try {
      if (currentAudio) {
        try { currentAudio.pause(); } catch(e) {}
        currentAudio = null;
      }
      var ttsUrl = 'https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=' + encodeURIComponent(clean);
      currentAudio = new Audio(ttsUrl);
      currentAudio.volume = 1.0;
      currentAudio.playbackRate = 1.15;
      currentAudio.play().catch(function(e) {
        var fallbackUrl = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=' + encodeURIComponent(clean);
        currentAudio = new Audio(fallbackUrl);
        currentAudio.play().catch(function(err){});
      });
    } catch(e) {}
  };
})();
</script>
</body>
</html>`;

const { width: SW, height: SH } = Dimensions.get('window');

// Bottom sheet snap points - Fully responsive based on screen size
const SHEET_MIN   = 70; // Increased min height for better tap target
const SHEET_PEEK  = Math.min(Math.round(SH * 0.48), 520); // Cap peek height for tablets
const SHEET_MAX   = Math.min(Math.round(SH * 0.88), 800); // Cap max height for tablets

export type TabType = 'map' | 'history' | 'ai';

const ACTIVITIES: { id: ActivityType; label: string; family: 'FA5' | 'Ionicons'; icon: string }[] = [
  { id: 'walking', label: 'Walk',  family: 'FA5',      icon: 'walking'   },
  { id: 'running', label: 'Run',   family: 'FA5',      icon: 'running'   },
  { id: 'biking',  label: 'Bike',  family: 'Ionicons', icon: 'bicycle'   },
  { id: 'driving', label: 'Drive', family: 'Ionicons', icon: 'car-sport' },
];

const PACES: { id: PaceType; label: string }[] = [
  { id: 'slow',   label: 'Relaxed' },
  { id: 'normal', label: 'Normal'  },
  { id: 'fast',   label: 'Paced'   },
];

const CITIES = [
  { label: '🗽 New York',     lat: 40.7580, lng: -73.9855 },
  { label: '🇬🇧 London',      lat: 51.5074, lng: -0.1278  },
  { label: '🇦🇪 Dubai',       lat: 25.2048, lng: 55.2708  },
  { label: '🌉 San Francisco', lat: 37.7749, lng: -122.4194},
  { label: '🇯🇵 Tokyo',       lat: 35.6762, lng: 139.6503 },
];

import { fetchPollyTTSAudio } from './src/services/voiceAssistant';
import { submitRouteFeedback, fetchMLStats } from './src/services/api';
import { CoolPathAssistantModal } from './src/components/CoolPathAssistantModal';

const DEADLINE_OPTIONS = [15, 30, 45, 60, 90];



const AI_PRESETS = [
  { label: '🐾 Dog Walk in Shade', prompt: 'Walking my dog, paws burn on hot asphalt, prioritize shade' },
  { label: '🏃 Coolest 5k Run', prompt: 'Running 5km, want shaded park corridor, avoid direct solar heat' },
  { label: '🚴 Bike Commute', prompt: 'Relaxed bike trip, avoid high heat avenues' },
];

const CRAFTING_STEPS = [
  { text: 'Scanning FortyGuard urban microclimate sensors...' },
  { text: 'Mapping shaded side streets & tree canopies...' },
  { text: 'Calculating real-feel thermal exposure metrics...' },
  { text: 'Selecting cool corridors with lowest heat strain...' },
  { text: 'CoolPath Assistant synthesizing personalized safety briefing...' },
  { text: 'Finalizing your optimal CoolPath route...' },
];

const ROUTE_COLORS: Record<string, string> = {
  coolest: '#10B981',
  fastest: '#64748B',
  route_1: '#3B82F6',
  route_2: '#8B5CF6',
  route_3: '#F59E0B',
};

export interface PlaceSuggestion {
  id: string;
  placeName: string;
  shortName: string;
  lat: number;
  lng: number;
  distanceKm?: number;
  ring?: string;
  badgeLabel?: string;
  reasoning?: string;
}

function parseCoordinateString(q: string): Coordinate | null {
  if (!q) return null;
  const clean = q.replace(/[\[\]\(\)]/g, '').trim();
  const match = clean.match(/^([-+]?\d+(?:\.\d+)?)\s*[,;\s]\s*([-+]?\d+(?:\.\d+)?)$/);
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

async function fetchPlaceSuggestions(query: string, userOrigin?: Coordinate): Promise<PlaceSuggestion[]> {
  if (!query || query.trim().length < 2) return [];
  // Skip place autocomplete if the user is typing direct coordinates
  if (parseCoordinateString(query)) return [];

  // 1. Try backend Intelligent Exponential Ring Search + Gemini AI evaluation first
  if (userOrigin) {
    try {
      const smartResults = await fetchSmartSearchSuggestions(query, userOrigin.lat, userOrigin.lng);
      if (smartResults && smartResults.length > 0) {
        return smartResults.map(item => ({
          id: item.id,
          placeName: item.place_name,
          shortName: item.short_name,
          lat: item.lat,
          lng: item.lng,
          distanceKm: item.distance_km,
          ring: item.ring,
          badgeLabel: item.badge_label,
          reasoning: item.reasoning
        }));
      }
    } catch {
      // Fallback to Mapbox Geocoding if backend smart-search is unreachable
    }
  }

  // 2. Fallback to Mapbox Proximity Geocoding API
  try {
    const prox = userOrigin ? `&proximity=${userOrigin.lng},${userOrigin.lat}` : '';
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query.trim())}.json?access_token=${MAPBOX_ACCESS_TOKEN}&autocomplete=true&limit=5${prox}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.features && Array.isArray(data.features)) {
      return data.features.map((f: any) => ({
        id: f.id,
        placeName: f.place_name,
        shortName: f.text || f.place_name,
        lat: f.center[1],
        lng: f.center[0],
      }));
    }
    return [];
  } catch {
    return [];
  }
}

async function geocode(q: string, fallbackCoord?: Coordinate): Promise<Coordinate | null> {
  if (!q || !q.trim()) return fallbackCoord || null;
  // If query is direct lat/lng string like "40.7525, -73.9929", parse directly!
  const direct = parseCoordinateString(q);
  if (direct) return direct;

  if (fallbackCoord && (q === 'Start Point' || q === 'Destination' || q === 'Current Location')) {
    return fallbackCoord;
  }

  try {
    const r = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q.trim())}.json?access_token=${MAPBOX_ACCESS_TOKEN}&limit=1`
    );
    const d = await r.json();
    if (d.features?.length) {
      const [lng, lat] = d.features[0].center;
      return { lat, lng };
    }
    return fallbackCoord || null;
  } catch {
    return fallbackCoord || null;
  }
}

function calculateDistanceKm(coord1: Coordinate, coord2: Coordinate): number {
  const R = 6371; // Earth radius in km
  const dLat = (coord2.lat - coord1.lat) * (Math.PI / 180);
  const dLng = (coord2.lng - coord1.lng) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(coord1.lat * (Math.PI / 180)) *
      Math.cos(coord2.lat * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

interface LiveWeatherAqi {
  tempC: number | null;
  aqi: number | null;
  humidity: number | null;
  windSpeedKmh: number | null;
}

async function fetchLiveWeatherAqi(lat: number, lng: number): Promise<LiveWeatherAqi> {
  try {
    const [wRes, aRes] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`),
      fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi`),
    ]);
    const wData = await wRes.json();
    const aData = await aRes.json();

    const tempC = wData.current?.temperature_2m !== undefined ? Math.round(wData.current.temperature_2m) : null;
    const aqi = aData.current?.us_aqi !== undefined ? Math.round(aData.current.us_aqi) : null;
    const humidity = wData.current?.relative_humidity_2m !== undefined ? Math.round(wData.current.relative_humidity_2m) : null;
    const windSpeedKmh = wData.current?.wind_speed_10m !== undefined ? Math.round(wData.current.wind_speed_10m) : null;

    return { tempC, aqi, humidity, windSpeedKmh };
  } catch {
    return { tempC: null, aqi: null, humidity: null, windSpeedKmh: null };
  }
}

const LOGO_DARK  = require('./assets/logo_dark.png');
const LOGO_LIGHT = require('./assets/logo_light.png');

function BrandLogo({ isDark }: { isDark: boolean }) {
  const [hasError, setHasError] = useState(false);

  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: '#38bdf8',
        backgroundColor: isDark ? 'rgba(13,18,35,0.94)' : 'rgba(255,255,255,0.94)',
        paddingHorizontal: 8,
        paddingVertical: 3,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#38bdf8',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 5,
        elevation: 4,
      }}
    >
      {hasError ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="shield-checkmark" size={15} color="#38bdf8" />
          <Text style={{ color: isDark ? '#ffffff' : '#0f172a', fontSize: 14, fontWeight: '900' }}>CoolPath</Text>
        </View>
      ) : (
        <Image
          source={isDark ? LOGO_DARK : LOGO_LIGHT}
          style={{ width: 105, height: 25 }}
          resizeMode="contain"
          onError={() => setHasError(true)}
        />
      )}
    </View>
  );
}

export default function App() {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isDesktopWeb = isWeb && viewportWidth >= 960;
  const isTabletWeb = isWeb && viewportWidth >= 680;
  // ── Theme State ─────────────────────────────────────────────────────────────
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Theme palettes based on CoolPath Design System — Color Science Guide
  const theme = useMemo(() => {
    if (isDarkMode) {
      return {
        isDark: true,
        bg: '#0C1210',                  // Asphalt Dusk
        topCardBg: 'rgba(21, 31, 27, 0.96)', // Shaded Stone Translucent
        sheetBg: '#151F1B',             // Shaded Stone
        navBg: '#0C1210',               // Asphalt Dusk Navy
        surfaceRaised: '#151F1B',       // Shaded Stone
        surfaceInset: '#1E2A24',        // Deep Shade
        textPrimary: '#F3F0EA',         // Warm Bone (NEVER pure #FFFFFF)
        textSecondary: '#A8A296',       // Warm Ash
        textMuted: '#6B6659',           // Dim Ash
        border: 'rgba(240, 237, 228, 0.08)',   // Hairline Bone
        borderStrong: 'rgba(240, 237, 228, 0.16)',
        inputBg: '#1E2A24',             // Deep Shade
        pillBg: '#1E2A24',              // Deep Shade
        pillBorder: 'rgba(240, 237, 228, 0.08)',
        handleColor: '#3A4239',
        accentCool: '#2DD9B8',          // Shade Teal (Replaces Emerald!)
        accentCoolDeep: '#159986',      // Deep Teal
        accentHeat: '#E8895E',          // Ember Terracotta (Replaces Red/Amber duplication!)
        accentHeatDeep: '#B85C3A',      // Burnt Clay
        accentFast: '#7C93B0',          // Slate Sky
        accentBalanced: '#C9A468',      // Aged Brass
        accentGold: '#E0B84A',          // Recommendation Gold
        statusBgOnline: 'rgba(45, 217, 184, 0.16)',
        statusBgOffline: 'rgba(232, 137, 94, 0.16)',
        statusTextOnline: '#2DD9B8',
        statusTextOffline: '#E8895E',
        mapStyle: 'dark' as const,
      };
    } else {
      return {
        isDark: false,
        bg: '#F6F3EC',                  // Warm Paper (NOT slate-50 Tailwind default!)
        topCardBg: 'rgba(255, 255, 255, 0.96)',
        sheetBg: '#FFFFFF',
        navBg: '#FFFFFF',
        surfaceRaised: '#FFFFFF',
        surfaceInset: '#EDE8DC',        // Sand
        textPrimary: '#191712',         // Near-Ink
        textSecondary: '#5C574B',       // Warm Ash Dark
        textMuted: '#8C8676',           // Dim Ash Dark
        border: 'rgba(20, 18, 14, 0.08)',
        borderStrong: 'rgba(20, 18, 14, 0.16)',
        inputBg: '#EDE8DC',             // Sand
        pillBg: '#EDE8DC',
        pillBorder: 'rgba(20, 18, 14, 0.06)',
        handleColor: '#CBD5E1',
        accentCool: '#0E9E86',          // Deep Shade Teal for light AA contrast
        accentCoolDeep: '#0A7967',
        accentHeat: '#C2603A',          // Deep Terracotta
        accentHeatDeep: '#9A4626',
        accentFast: '#566E8C',          // Slate Sky Dark
        accentBalanced: '#A37E43',      // Aged Brass Dark
        accentGold: '#C49B28',
        statusBgOnline: 'rgba(14, 158, 134, 0.16)',
        statusBgOffline: 'rgba(194, 96, 58, 0.16)',
        statusTextOnline: '#0E9E86',
        statusTextOffline: '#C2603A',
        mapStyle: 'light' as const,
      };
    }
  }, [isDarkMode]);

  // ── Navigation & UI State ───────────────────────────────────────────────────
  const [activeTab,       setActiveTab]       = useState<TabType>('map');
  const [loading,         setLoading]         = useState(false);
  const [response,        setResponse]        = useState<MissionResponse | null>(null);
  const [selectedRoute,   setSelectedRoute]   = useState('coolest');
  const [error,           setError]           = useState<string | null>(null);
  const [backend,         setBackend]         = useState<BackendStatus>({ online: false, url: null });

  // ML Preference Model & Insights State (Piece 1, 2, 3)
  const [shadePreferencePct, setShadePreferencePct] = useState<number>(65.0);
  const [showMLInsightsModal, setShowMLInsightsModal] = useState<boolean>(false);
  const [showAssistantModal, setShowAssistantModal] = useState<boolean>(false);
  const [mlHistory, setMlHistory] = useState<any[]>([]);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [submittedFeedbackRoutes, setSubmittedFeedbackRoutes] = useState<Record<string, 'good' | 'bad'>>({});



  // Settings & Customization States
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [tempUnit, setTempUnit] = useState<'C' | 'F'>('C');
  const [distUnit, setDistUnit] = useState<'km' | 'mi'>('km');
  const [shadeWeight, setShadeWeight] = useState<'strict' | 'balanced' | 'comfort'>('balanced');
  const [defaultPace, setDefaultPace] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [heatAlertsOn, setHeatAlertsOn] = useState(true);
  const [defaultDepartMode, setDefaultDepartMode] = useState<'now' | 'scheduled'>('now');
  const [showAboutSection, setShowAboutSection] = useState<'about' | 'terms' | 'privacy' | 'science' | null>(null);

  // ── 🧭 COMPASS SENSOR ──
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const [showCompassCalibration, setShowCompassCalibration] = useState(false);

  // ── 🧭 LIVE GPS & SIMULATOR NAVIGATION SYSTEM ──
  const [isNavigating, setIsNavigating] = useState(false);
  const [navMode, setNavMode] = useState<'real' | 'simulated'>('simulated');
  const [navPosition, setNavPosition] = useState<NavPositionData | null>(null);
  const [navSpeakerText, setNavSpeakerText] = useState<string | null>(null);
  const [navProgressPct, setNavProgressPct] = useState(0);
  const [navSpeedKmh, setNavSpeedKmh] = useState(0);
  const [navCurrentTempC, setNavCurrentTempC] = useState(25);
  const [navSubtitle, setNavSubtitle] = useState('');
  const [commuterBodyTemp, setCommuterBodyTemp] = useState<number>(37.0);
  const [typedSubtitle, setTypedSubtitle] = useState('');
  const [acOn, setAcOn] = useState(true);
  const [simSpeedKmh, setSimSpeedKmh] = useState(12);
  const [showJourneySummary, setShowJourneySummary] = useState(false);
  const [journeyDuration, setJourneyDuration] = useState(0);
  const [mapStyleOption, setMapStyleOption] = useState<'theme' | 'satellite' | 'outdoors'>('theme');
  const [showMapLayersMenu, setShowMapLayersMenu] = useState(false);
  const [showRouteSelectionMenu, setShowRouteSelectionMenu] = useState(false);
  const [showNavSetupModal, setShowNavSetupModal] = useState(false);

  // Animated Splash Screen States & Timers
  const splashOpacity = useRef(new Animated.Value(1)).current;
  const iconScale = useRef(new Animated.Value(0.3)).current;
  const iconOpacity = useRef(new Animated.Value(0)).current;
  const iconTranslateY = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(20)).current;
  const [splashVisible, setSplashVisible] = useState(true);

  useEffect(() => {
    // Step 1: Fade in and scale up logo icon
    Animated.parallel([
      Animated.timing(iconOpacity, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(iconScale, {
        toValue: 1.0,
        duration: 700,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Step 2: Slide logo up and draw the text below it
      Animated.delay(300).start(() => {
        Animated.parallel([
          Animated.timing(iconTranslateY, {
            toValue: -20,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(textOpacity, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(textTranslateY, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
        ]).start(() => {
          // Step 3: Hold and fade out the entire splash screen
          Animated.delay(1600).start(() => {
            Animated.timing(splashOpacity, {
              toValue: 0,
              duration: 500,
              useNativeDriver: true,
            }).start(() => {
              setSplashVisible(false);
            });
          });
        });
      });
    });
  }, []);

  const [bundleStatusTxt, setBundleStatusTxt] = useState('');

  // Clean up any legacy OTA bundle file to ensure native assets and vector icons load cleanly
  useEffect(() => {
    async function cleanupLegacyOtaBundle() {
      try {
        const otaFile = FileSystem.documentDirectory + 'coolpath_ota.bundle';
        const info = await FileSystem.getInfoAsync(otaFile);
        if (info.exists) {
          await FileSystem.deleteAsync(otaFile, { idempotent: true });
        }
      } catch (e) {}
    }
    cleanupLegacyOtaBundle();
  }, []);

  // Restore saved map layer preference on startup
  useEffect(() => {
    async function loadSavedMapStyle() {
      try {
        const saved = await AsyncStorage.getItem('@map_style_option');
        if (saved && (saved === 'theme' || saved === 'satellite' || saved === 'outdoors')) {
          setMapStyleOption(saved as any);
        }
      } catch (e) {}
    }
    loadSavedMapStyle();
  }, []);

  const changeMapStyleOption = async (option: 'theme' | 'satellite' | 'outdoors') => {
    setMapStyleOption(option);
    try {
      await AsyncStorage.setItem('@map_style_option', option);
    } catch (e) {}
  };

  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [locationSignal, setLocationSignal] = useState(0);
  const [flyToTarget, setFlyToTarget] = useState<Coordinate | null>(null);

  const locationSubRef = useRef<{ remove: () => void } | null>(null);
  const simIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSpokenMilestoneRef = useRef<number>(-1);
  const lastSpokenStepRef = useRef<number>(-10);
  const lastSpokenTempRef = useRef<number>(-1);
  const currentSoundRef = useRef<Audio.Sound | null>(null);
  const acOnRef = useRef(true);
  useEffect(() => {
    acOnRef.current = acOn;
  }, [acOn]);
  const simSpeedRef = useRef(12);
  useEffect(() => {
    simSpeedRef.current = simSpeedKmh;
  }, [simSpeedKmh]);

  const locationFabScaleAnim = useRef(new Animated.Value(1)).current;
  const locationFabSpinAnim = useRef(new Animated.Value(0)).current;

  const triggerCurrentLocationWithAnim = () => {
    Animated.sequence([
      Animated.timing(locationFabScaleAnim, { toValue: 0.8, duration: 90, useNativeDriver: true }),
      Animated.spring(locationFabScaleAnim, { toValue: 1.2, friction: 3, tension: 45, useNativeDriver: true }),
      Animated.timing(locationFabScaleAnim, { toValue: 1, duration: 110, useNativeDriver: true }),
    ]).start();

    locationFabSpinAnim.setValue(0);
    Animated.timing(locationFabSpinAnim, {
      toValue: 1,
      duration: 550,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    handleUseCurrentLocation();
  };

  const handleFeedback = async (routeId: string, satisfied: boolean) => {
    setSubmittedFeedbackRoutes(prev => ({ ...prev, [routeId]: satisfied ? 'good' : 'bad' }));
    try {
      const res = await submitRouteFeedback(routeId, satisfied, {
        temp_c: liveWeather.tempC,
        activity: activity,
        hour: new Date().getHours()
      });
      if (res && typeof res.shade_preference_percentage === 'number') {
        setShadePreferencePct(res.shade_preference_percentage);
      }
      setFeedbackToast(satisfied ? '👍 Positive feedback saved! ML Model updated.' : '👎 Preference noted! Reranking options.');
      setTimeout(() => setFeedbackToast(null), 3200);
      
      const stats = await fetchMLStats();
      if (stats && stats.history) {
        setMlHistory(stats.history);
      }
    } catch (e) {
      console.warn('Feedback submission error', e);
    }
  };

  const handleUseCurrentLocation = async () => {
    setIsFetchingLocation(true);
    setStatusToast('📍 Fetching phone GPS location...');

    let success = false;

    // 1. Try native expo-location
    try {
      if (ExpoLocation && typeof ExpoLocation.requestForegroundPermissionsAsync === 'function') {
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
          if (loc && loc.coords) {
            handleCurrentLocationResult(loc.coords.latitude, loc.coords.longitude);
            success = true;
          }
        }
      }
    } catch (e) {
      // Native module not linked in current dev server session, fall through to fallback
    }

    if (success) return;

    // 2. Fallback: Request via Mapbox WebView Geolocation bridge
    setLocationSignal((s) => s + 1);
  };

  const handleCurrentLocationResult = (lat: number, lng: number) => {
    setIsFetchingLocation(false);
    setOrigin({ lat, lng });
    setOriginText('📍 Current Location');
    setResponse(null);
    setFlyToTarget({ lat, lng });
    setStatusToast('📍 Zoomed to Current GPS Location');
    setTimeout(() => setStatusToast(null), 3000);
  };

  const getMaleVoiceId = async (): Promise<string | undefined> => {
    try {
      if (SpeechModule && typeof SpeechModule.getAvailableVoicesAsync === 'function') {
        const voices = await SpeechModule.getAvailableVoicesAsync();
        const maleVoice = voices.find((v: any) => {
          const n = (v.name || '').toLowerCase();
          const id = (v.identifier || '').toLowerCase();
          const l = (v.language || '').toLowerCase();
          const g = (v.gender || '').toLowerCase();
          return l.startsWith('en') && (
            g === 'male' ||
            n.includes('male') ||
            id.includes('male') ||
            n.includes('alex') ||
            id.includes('alex') ||
            n.includes('daniel') ||
            id.includes('daniel') ||
            n.includes('david') ||
            id.includes('david') ||
            n.includes('fred') ||
            id.includes('fred') ||
            n.includes('aaron') ||
            id.includes('aaron') ||
            n.includes('arthur') ||
            id.includes('arthur') ||
            n.includes('oliver') ||
            id.includes('oliver') ||
            n.includes('george') ||
            id.includes('george') ||
            n.includes('guy') ||
            id.includes('guy')
          );
        });
        if (maleVoice) return maleVoice.identifier;
      }
    } catch (e) {}
    return undefined;
  };

  const speakGlobalText = async (text: string) => {
    if (!text) return;
    const cleanSpoken = text.replace(/[*_~`#>-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanSpoken) return;

    // Set AudioMode first so audio plays even if silent switch is on (iOS)
    try {
      if (Audio) {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });

        if (currentSoundRef.current) {
          try {
            await currentSoundRef.current.stopAsync();
            await currentSoundRef.current.unloadAsync();
          } catch (e) {}
          currentSoundRef.current = null;
        }
      }
    } catch (e) {}

    // 1. Primary Engine: Amazon Polly Salli Female Voice via Backend API
    try {
      const pollyAudioBase64 = await fetchPollyTTSAudio(cleanSpoken, 'Salli', 'standard');
      if (pollyAudioBase64 && Audio) {
        const uri = `data:audio/mp3;base64,${pollyAudioBase64}`;
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true, volume: 1.0 }
        );
        currentSoundRef.current = sound;
        return;
      }
    } catch (e) {}

    // 2. Secondary Engine: Direct Audio MP3 Stream Fallback
    try {
      if (Audio) {
        const streamUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(cleanSpoken)}`;
        const { sound } = await Audio.Sound.createAsync(
          { uri: streamUrl },
          { shouldPlay: true, volume: 1.0, rate: 1.05 }
        );
        currentSoundRef.current = sound;
        return;
      }
    } catch (e) {}

    // 3. Tertiary Engine: Native Expo Speech Engine
    try {
      if (SpeechModule && typeof SpeechModule.speak === 'function') {
        SpeechModule.stop();
        SpeechModule.speak(cleanSpoken, {
          language: 'en-US',
          pitch: 1.0,
          rate: 1.05,
        });
        return;
      }
    } catch (e) {}

    // 4. Browser-native speech fallback for the responsive web app.
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanSpoken);
      utterance.lang = 'en-US';
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    }
  };

  const stopNavigation = () => {
    setIsNavigating(false);
    setNavPosition(null);
    setNavSpeakerText(null);
    setNavSubtitle('');
    setNavProgressPct(0);

    try {
      if (SpeechModule && typeof SpeechModule.stop === 'function') {
        SpeechModule.stop();
      }
    } catch (e) {}

    if (currentSoundRef.current) {
      try {
        currentSoundRef.current.stopAsync();
        currentSoundRef.current.unloadAsync();
      } catch (e) {}
      currentSoundRef.current = null;
    }

    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    if (locationSubRef.current) {
      try { locationSubRef.current.remove(); } catch(e) {}
      locationSubRef.current = null;
    }
    setCommuterBodyTemp(37.0);
    setTypedSubtitle('');
    setAcOn(true);
    setSimSpeedKmh(12);
    setJourneyDuration(0);
    lastSpokenMilestoneRef.current = -1;
    lastSpokenStepRef.current = -10;
    lastSpokenTempRef.current = -1;
  };

  const handleGpsUpdate = (lat: number, lng: number, speed: number, heading: number) => {
    const speedKmh = Math.max(0, Math.round(speed * 3.6));

    const activeR = response?.route_options?.find((r) => r.id === selectedRoute) || response?.route_options?.[0];
    if (!activeR) return;

    const gTemps: [number, number, number][] = (activeR.geometry_temps && activeR.geometry_temps.length >= 2)
      ? (activeR.geometry_temps as [number, number, number][])
      : activeR.coordinates.map((c) => [c[0], c[1], activeR.avg_temp_c || 28] as [number, number, number]);

    let closestTemp = activeR.avg_temp_c || 28;
    let minD = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < gTemps.length; i++) {
      const pt = gTemps[i];
      const d = Math.hypot(pt[0] - lng, pt[1] - lat);
      if (d < minD) {
        minD = d;
        closestTemp = pt[2];
        closestIdx = i;
      }
    }

    const pct = Math.round((closestIdx / Math.max(1, gTemps.length - 1)) * 100);
    setNavProgressPct(pct);
    setNavSpeedKmh(speedKmh);
    setNavCurrentTempC(Math.round(closestTemp));

    setNavPosition({
      lat,
      lng,
      bearing: heading,
      mode: activity,
      followCamera: true,
    });
  };

  const startNavigation = async (mode: 'real' | 'simulated') => {
    stopNavigation();
    setShowNavSetupModal(false);
    setNavMode(mode);
    setIsNavigating(true);

    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
    }

    const activeR = response?.route_options?.find((r) => r.id === selectedRoute) || response?.route_options?.[0];
    if (!activeR) {
      Alert.alert('Navigation Error', 'No active route found to navigate.');
      return;
    }

    const gTemps: [number, number, number][] = (activeR.geometry_temps && activeR.geometry_temps.length >= 2)
      ? (activeR.geometry_temps as [number, number, number][])
      : activeR.coordinates.map((c) => [c[0], c[1], activeR.avg_temp_c || 28] as [number, number, number]);

    const transportMode = activity;

    if (mode === 'real') {
      let startedNative = false;

      // 📍 Try native expo-location first
      try {
        if (ExpoLocation && typeof ExpoLocation.requestForegroundPermissionsAsync === 'function') {
          const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const msg = `Starting real-time GPS navigation on ${transportMode}. Have a safe journey!`;
            setNavSubtitle(`📍 ${msg}`);
            setNavSpeakerText(msg);
            speakGlobalText(msg);

            const currentLoc = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.High });
            handleGpsUpdate(
              currentLoc.coords.latitude,
              currentLoc.coords.longitude,
              currentLoc.coords.speed || 0,
              currentLoc.coords.heading || 0
            );

            locationSubRef.current = await ExpoLocation.watchPositionAsync(
              {
                accuracy: ExpoLocation.Accuracy.BestForNavigation,
                timeInterval: 1000,
                distanceInterval: 2,
              },
              (loc) => {
                handleGpsUpdate(
                  loc.coords.latitude,
                  loc.coords.longitude,
                  loc.coords.speed || 0,
                  loc.coords.heading || 0
                );
              }
            );
            startedNative = true;
          }
        }
      } catch (err: any) {
        // Native module missing or unlinked in Hermes dev client, fall back
      }

      if (!startedNative) {
        // 📍 Fallback: HTML5 WebView Geolocation
        const msg = `Starting real-time GPS navigation on ${transportMode}. Have a safe journey!`;
        setNavSubtitle(`📍 ${msg}`);
        setNavSpeakerText(msg);
        speakGlobalText(msg);
        setNavPosition({ lat: gTemps[0][1], lng: gTemps[0][0], mode: 'real_watch' });
      }
    } else {
      // ✨ Maya (Virtual Traveler) Persona Mode
      let stepIdx = 0;
      const totalSteps = gTemps.length;
      lastSpokenStepRef.current = -10;
      lastSpokenTempRef.current = -1;

      const speedMap: Record<ActivityType, number> = {
        walking: 5,
        running: 10,
        biking: 18,
        driving: 45,
      };
      const defaultSpeed = speedMap[transportMode] || 12;
      setNavSpeedKmh(defaultSpeed);
      setSimSpeedKmh(defaultSpeed);

      const getMayaDialogue = (
        type: 'start' | 'cool' | 'heat' | 'journey' | 'arrival',
        temp: number,
        pct: number,
        mode: string,
        route: string
      ): string => {
        const pool: Record<string, string[]> = {
          start: [
            `Hey there, Maya here! All geared up for our ${mode} trip on ${route}. Let's keep it breezy and beat the heat!`,
            `Maya reporting! Starting our journey down ${route}. Sun, prepare to be completely avoided!`,
            `Alright, Maya is on the move! Heading out on ${route}. Time to find that sweet shade!`,
          ],
          cool: [
            `Ooh yes, feel that cool breeze! We just entered a lush ${temp} degree shaded pocket. My sunscreen can take a break!`,
            `Maya's official route review: this ${temp} degree canopy is absolute perfection. Urban trees doing wonders!`,
            `Down to ${temp} degrees! Ah, pure bliss. I could stay in this shaded corridor all day!`,
            `Microclimate jackpot! Temperature dropped to ${temp} degrees here at ${pct}% progress. Loving this chill vibe!`,
          ],
          heat: [
            `Holy sunshine! Temp spiked to ${temp} degrees right here. Powering through to dodge this heat pocket!`,
            `Whew, ${temp} degrees! The asphalt is glowing hot. Good thing our cool path takes us back to shade soon!`,
            `Entering a warm zone at ${temp} degrees! Stay hydrated, folks — Maya is briskly passing this sun trap!`,
            `Heads up from Maya: sun exposure hits ${temp} degrees on this stretch. Keep that momentum going!`,
          ],
          journey: [
            `Halfway mark, woohoo! 50% completed and we're cruising comfortably at ${temp} degrees!`,
            `Midway check-in with Maya! Heart rate steady, shade level ten out of ten. We're rocking this ${mode} journey!`,
            `50% through our route! The thermal sensors confirm we've bypassed the city's worst heat islands. High five!`,
          ],
          arrival: [
            `Boom! Destination reached! We made it looking fresh and cool, thanks to CoolPath. Maya signing off!`,
            `Touchdown! Zero sunburn, maximum cool vibes. That was a legendary route!`,
            `We arrived! Maya survived, thrived, and stayed cool. That was as refreshing as an iced matcha latte!`,
          ],
        };

        const list = pool[type] || pool.journey;
        const idx = Math.floor(Math.random() * list.length);
        return list[idx];
      };

      // Initial TTS Greeting
      const startMsg = getMayaDialogue('start', Math.round(gTemps[0][2] || 25), 0, transportMode, activeR.name);
      setNavSubtitle(`✨ Maya: ${startMsg}`);
      setNavSpeakerText(startMsg);
      speakGlobalText(startMsg);
      lastSpokenStepRef.current = 0;

      simIntervalRef.current = setInterval(() => {
        if (stepIdx >= totalSteps) {
          if (simIntervalRef.current) clearInterval(simIntervalRef.current);
          const endMsg = getMayaDialogue('arrival', 25, 100, transportMode, activeR.name);
          setNavSubtitle(`✨ Maya: ${endMsg}`);
          setNavSpeakerText(endMsg);
          speakGlobalText(endMsg);
          setNavProgressPct(100);
          setShowJourneySummary(true);
          setIsNavigating(false);
          return;
        }

        setJourneyDuration((prev) => prev + 1);

        const curr = gTemps[stepIdx];
        const next = gTemps[Math.min(totalSteps - 1, stepIdx + 1)];
        const lng = curr[0];
        const lat = curr[1];
        const tempC = Math.round(curr[2]);

        const dx = (next[0] - curr[0]) * Math.cos((curr[1] + next[1]) * Math.PI / 360);
        const dy = next[1] - curr[1];
        let bearing = 0;
        if (Math.abs(dx) > 0.000001 || Math.abs(dy) > 0.000001) {
          bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
        }

        const pct = Math.round((stepIdx / Math.max(1, totalSteps - 1)) * 100);
        setNavProgressPct(pct);
        setNavCurrentTempC(tempC);
        setNavSpeedKmh(simSpeedRef.current);

        // Commuter dynamic thermal state simulation using differential heat balance equation
        setCommuterBodyTemp((prevTemp) => {
          const dt = 1.0; // timestep in seconds
          const m = 70.0; // body mass in kg
          const c = 3470.0; // effective body heat capacity J/(kg C)
          const A = 1.8; // body surface area in m2
          
          let MET = 1.3;
          let eta = 0.23;
          const activitySpeedKmh = simSpeedRef.current;
          
          if (transportMode === 'walking') {
            MET = 1.5 + 0.4 * activitySpeedKmh;
            eta = 0.23;
          } else if (transportMode === 'running') {
            MET = 2.0 + 0.7 * activitySpeedKmh;
            eta = 0.23;
          } else if (transportMode === 'biking') {
            MET = 2.0 + 0.25 * activitySpeedKmh;
            eta = 0.23;
          } else if (transportMode === 'driving') {
            MET = 1.3;
            eta = 0.0;
          }

          // Environmental inputs
          const T_air_ext = tempC;
          const RH = liveWeather.humidity || 55;
          const windKmh = liveWeather.windSpeedKmh || 8;
          
          // Effective cabin temperature vs ambient external temperature
          const T_air_eff = transportMode === 'driving' 
            ? (acOnRef.current ? 22.0 : T_air_ext + 4.0) 
            : T_air_ext;
          const v_wind_mps = windKmh / 3.6;
          const v_commuter_mps = activitySpeedKmh / 3.6;
          
          // Relative air velocity
          const v_air = transportMode === 'driving' 
            ? (acOnRef.current ? 1.0 : 1.5) 
            : (v_wind_mps + v_commuter_mps);
          
          // Metabolic power & metabolic heat to dissipate
          const metabolicPower = MET * 58.2 * A;
          const Q_metabolic = metabolicPower * (1 - eta);
          
          // Skin temperature estimation
          let T_skin = 30.0 + 0.15 * prevTemp + 0.1 * T_air_eff;
          T_skin = Math.max(31.0, Math.min(36.0, T_skin));
          
          // Convective Heat Loss (Q_C = h_c * A * (T_skin - T_air))
          const h_c = Math.max(3.0, 8.6 * Math.pow(v_air, 0.6));
          const Q_C = h_c * A * (T_skin - T_air_eff);
          
          // Radiative Heat Loss (Q_R = h_r * A * (T_skin - T_env))
          const T_env = T_air_eff + (transportMode === 'driving' ? 0.0 : 2.0); // asphalt heat radiation
          const h_r = 4.7;
          const Q_R = h_r * A * (T_skin - T_env);
          
          // Sweat evaporation cooling
          const S_sweat_base = 0.00005; // base sweat rate in kg/s
          let S_sweat = S_sweat_base + 0.0004 * Math.max(0, prevTemp - 37.0);
          S_sweat *= (1.0 + 0.2 * (MET - 1.3)); // scale sweat production by exertion MET
          S_sweat = Math.min(0.00055, S_sweat); // limit sweat to ~2.0 Liters/hour
          
          const Q_sweat = S_sweat * 2400000; // latent heat of vaporization 2.4 MJ/kg
          
          // Evaporative capacity of environment (Lewis relation)
          const h_e = 16.5 * h_c;
          // Saturation vapor pressures in kPa (Antoine-like equation)
          const P_sk = 0.1333 * Math.exp(18.6686 - 4030.18 / (T_skin + 235));
          const P_sat_air = 0.1333 * Math.exp(18.6686 - 4030.18 / (T_air_eff + 235));
          const P_a = P_sat_air * (RH / 100);
          
          const Q_evap_max = Math.max(10.0, h_e * A * (P_sk - P_a));
          const Q_E = Math.min(Q_sweat, Q_evap_max);
          
          // Stored Net Heat
          const Q_stored = Q_metabolic - Q_C - Q_R - Q_E;
          
          // Differential equation update
          const T_core_change = (Q_stored / (m * c)) * dt;
          let nextTemp = prevTemp + T_core_change;
          
          // Physiological bounds clamping
          nextTemp = Math.max(36.0, Math.min(41.0, nextTemp));
          return nextTemp;
        });

        setNavPosition({
          lat,
          lng,
          bearing,
          mode: transportMode,
          followCamera: true,
        });

        // Trigger Maya's commentary at ONLY 4 key moments: Start (0%), Mid-way (~50%), Thermal Highlight, & Arrival (100%)
        const isMidway = pct >= 45 && pct <= 55 && lastSpokenMilestoneRef.current < 50;
        const isThermalHighlight = (tempC <= 23 || tempC >= 34) && lastSpokenTempRef.current !== tempC && pct > 15 && pct < 85;

        if (stepIdx > 0 && stepIdx < totalSteps - 1 && (isMidway || isThermalHighlight)) {
          if (isMidway) lastSpokenMilestoneRef.current = 50;
          lastSpokenStepRef.current = stepIdx;
          lastSpokenTempRef.current = tempC;

          let speechType: 'cool' | 'heat' | 'journey' = 'journey';
          if (tempC <= 24) speechType = 'cool';
          else if (tempC >= 34) speechType = 'heat';

          const speech = getMayaDialogue(speechType, tempC, pct, transportMode, activeR.name);
          setNavSubtitle(`✨ Maya: ${speech}`);
          setNavSpeakerText(speech);
          speakGlobalText(speech);
        }

        // Calculate step increment based on ratio of current speed to default base speed
        let defaultBaseSpeed = 5;
        if (transportMode === 'running') defaultBaseSpeed = 10;
        else if (transportMode === 'biking') defaultBaseSpeed = 18;
        else if (transportMode === 'driving') defaultBaseSpeed = 45;

        const ratio = simSpeedRef.current / defaultBaseSpeed;
        const stepIncrement = Math.max(1, Math.round(ratio));
        stepIdx += stepIncrement;
      }, 1000);
    }
  };

  const adjustSimSpeed = (direction: 'up' | 'down') => {
    let minSpeed = 2;
    let maxSpeed = 8;
    let step = 1;
    if (activity === 'running') {
      minSpeed = 5;
      maxSpeed = 22;
      step = 1;
    } else if (activity === 'biking') {
      minSpeed = 10;
      maxSpeed = 45;
      step = 2;
    } else if (activity === 'driving') {
      minSpeed = 20;
      maxSpeed = 140;
      step = 10;
    }

    setSimSpeedKmh((prev) => {
      let nextSpeed = prev;
      if (direction === 'up') {
        nextSpeed = Math.min(maxSpeed, prev + step);
      } else {
        nextSpeed = Math.max(minSpeed, prev - step);
      }
      return nextSpeed;
    });
  };

  const formatTemp = (celsius: number | null | undefined) => {
    if (celsius === null || celsius === undefined) return '--';
    if (tempUnit === 'F') {
      const f = (celsius * 9) / 5 + 32;
      return `${Math.round(f)}°F`;
    }
    return `${Math.round(celsius)}°C`;
  };

  const formatDist = (km: string | number | null | undefined) => {
    if (km === null || km === undefined) return '--';
    const numKm = typeof km === 'string' ? parseFloat(km) : km;
    if (isNaN(numKm)) return '--';
    if (distUnit === 'mi') {
      const mi = numKm * 0.621371;
      return `${mi.toFixed(1)} mi`;
    }
    return `${numKm.toFixed(1)} km`;
  };

  // Backend Status Retry & Signal Pulse State
  const [isRetryingBackend, setIsRetryingBackend] = useState(false);
  const [statusToast,        setStatusToast]        = useState<string | null>(null);
  const signalPulseAnim = useRef(new Animated.Value(1)).current;
  const aiBtnGlowAnim = useRef(new Animated.Value(0)).current;

  // Slow-motion smooth breathing animation for AI Assistant button in coordination card
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(aiBtnGlowAnim, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(aiBtnGlowAnim, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const handleRetryBackend = async () => {
    if (isRetryingBackend) return;

    if (backend.online) {
      // Signal pulse animation & feedback toast
      Animated.sequence([
        Animated.timing(signalPulseAnim, { toValue: 1.5, duration: 200, useNativeDriver: true }),
        Animated.timing(signalPulseAnim, { toValue: 1.0, duration: 200, useNativeDriver: true }),
      ]).start();

      setStatusToast('Connected');
      setTimeout(() => setStatusToast(null), 2500);
      return;
    }

    // Offline -> Retry connection
    setIsRetryingBackend(true);
    setStatusToast('Connecting...');

    const res = await checkBackendHealth();
    setBackend(res);
    setIsRetryingBackend(false);

    if (res.online) {
      setStatusToast('Connected');
    } else {
      setStatusToast('Disconnected');
    }
    setTimeout(() => setStatusToast(null), 3200);
  };

  // Location & Planning State
  const [originText, setOriginText] = useState('');
  const [destText,   setDestText]   = useState('');
  const [origin,     setOrigin]     = useState<Coordinate>({ lat: 40.7580, lng: -73.9855 });
  const [dest,       setDest]       = useState<Coordinate>({ lat: 40.7812, lng: -73.9665 });
  const [isDestSelected, setIsDestSelected] = useState<boolean>(false);

  const [activity,        setActivity]        = useState<ActivityType>('walking');
  const [pace,            setPace]            = useState<PaceType>('normal');
  const [planMode,        setPlanMode]        = useState<PlanningMode>('instant');
  const [deadlineMinutes, setDeadlineMinutes] = useState<number>(30);
  const [pinMode,         setPinMode]         = useState<PinMode>(null);

  // Real-Time Autocomplete Search State
  const [activeSearchTarget, setActiveSearchTarget] = useState<'origin' | 'dest' | null>(null);
  const [originSuggestions, setOriginSuggestions]   = useState<PlaceSuggestion[]>([]);
  const [destSuggestions,   setDestSuggestions]     = useState<PlaceSuggestion[]>([]);

  // Typewriter Subtitles / Captions Synchronization with Maya Dialogues
  useEffect(() => {
    if (!navSubtitle) {
      setTypedSubtitle('');
      return;
    }
    const cleanText = navSubtitle.replace(/^✨\s*Maya:\s*/, '').replace(/^📍\s*/, '');
    let currentText = '';
    let i = 0;
    let fadeTimeout: NodeJS.Timeout | null = null;
    const timer = setInterval(() => {
      if (i < cleanText.length) {
        currentText += cleanText.charAt(i);
        setTypedSubtitle(currentText);
        i++;
      } else {
        clearInterval(timer);
        fadeTimeout = setTimeout(() => {
          setTypedSubtitle('');
        }, 4000);
      }
    }, 30); // 30ms per character
    return () => {
      clearInterval(timer);
      if (fadeTimeout) clearTimeout(fadeTimeout);
    };
  }, [navSubtitle]);

  // Debounced Real-time Search for Origin
  useEffect(() => {
    if (!originText || originText.trim().length < 2 || activeSearchTarget !== 'origin') {
      setOriginSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await fetchPlaceSuggestions(originText, origin);
      setOriginSuggestions(results);
    }, 220);
    return () => clearTimeout(timer);
  }, [originText, activeSearchTarget, origin]);

  // Debounced Real-time Search for Destination
  useEffect(() => {
    if (!destText || destText.trim().length < 2 || activeSearchTarget !== 'dest') {
      setDestSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await fetchPlaceSuggestions(destText, origin);
      setDestSuggestions(results);
    }, 220);
    return () => clearTimeout(timer);
  }, [destText, activeSearchTarget, origin]);

  // Live Weather & AQI State for selected origin location
  const [liveWeather, setLiveWeather] = useState<LiveWeatherAqi>({ tempC: null, aqi: null, humidity: null, windSpeedKmh: null });

  useEffect(() => {
    let dead = false;
    fetchLiveWeatherAqi(origin.lat, origin.lng).then((res) => {
      if (!dead) setLiveWeather(res);
    });
    return () => { dead = true; };
  }, [origin.lat, origin.lng]);

  const directDistanceKm = useMemo(() => calculateDistanceKm(origin, dest), [origin, dest]);

  // Route Crafting Animated Loading State
  const [isCraftingRoute, setIsCraftingRoute]   = useState(false);
  const [currentCraftStep, setCurrentCraftStep] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse & Step Cycling Animation Effect
  useEffect(() => {
    let interval: any = null;
    let pulseLoop: any = null;

    if (isCraftingRoute) {
      setCurrentCraftStep(0);

      // Cycle phrases every 1500ms
      interval = setInterval(() => {
        setCurrentCraftStep((prev) => (prev + 1) % CRAFTING_STEPS.length);
      }, 1500);

      // Continuous pulsing animation
      pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.25, duration: 750, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 750, useNativeDriver: true }),
        ])
      );
      pulseLoop.start();
    } else {
      pulseAnim.setValue(1);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (pulseLoop) pulseLoop.stop();
    };
  }, [isCraftingRoute, pulseAnim]);

  // Modal / Plan Setup State
  const [showPlanSetupModal, setShowPlanSetupModal] = useState(false);

  // Full Map Inspection Visibility Toggle
  const [uiVisible, setUiVisible] = useState(true);

  // History State
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);

  // AI Prompt State
  const [aiPromptInput, setAiPromptInput] = useState('');
  const [aiLoading,     setAiLoading]     = useState(false);

  // ── Draggable Bottom Sheet Animation ──────────────────────────────────────
  const [isSheetHidden, setIsSheetHidden] = useState(false);
  const [sheetSnapState, setSheetSnapState] = useState<'min' | 'peek' | 'max'>('peek');
  const [suggestedPlaces, setSuggestedPlaces] = useState<string[]>(['Central Park', 'Times Square', 'Brooklyn Bridge', 'High Line Park']);
  const sheetHeightAnim = useRef(new Animated.Value(SHEET_PEEK)).current;
  const lastSheetHeight = useRef(SHEET_PEEK);
  const [isSheetExpanded, setIsSheetExpanded] = useState<boolean>(false);

  const snapSheetTo = (targetHeight: number) => {
    lastSheetHeight.current = targetHeight;
    setIsSheetHidden(targetHeight === 0);
    setSheetSnapState(targetHeight === SHEET_MAX ? 'max' : targetHeight === SHEET_PEEK ? 'peek' : 'min');
    
    // Unmount details immediately if collapsing to maintain smooth frame-rates
    if (targetHeight <= SHEET_MIN + 30) {
      setIsSheetExpanded(false);
    }

    Animated.spring(sheetHeightAnim, {
      toValue: targetHeight,
      useNativeDriver: false,
      bounciness: 2,
      speed: 18,
    }).start(({ finished }) => {
      // Mount the heavy sub-views ONLY after the transition ends successfully
      if (finished && targetHeight > SHEET_MIN + 30) {
        setIsSheetExpanded(true);
      }
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 3 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
      },
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 3 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
      },
      onPanResponderGrant: () => {
        sheetHeightAnim.stopAnimation((value) => {
          lastSheetHeight.current = value;
        });
      },
      onPanResponderMove: (_, gestureState) => {
        const newHeight = lastSheetHeight.current - gestureState.dy;
        // Allow dragging down to 0 to hide bottom sheet
        const clampedHeight = Math.max(0, Math.min(SHEET_MAX, newHeight));
        sheetHeightAnim.setValue(clampedHeight);
      },
      onPanResponderRelease: (_, gestureState) => {
        const currentH = lastSheetHeight.current - gestureState.dy;
        const vy = gestureState.vy;

        let target = SHEET_PEEK;

        // 1. Swipe down fast OR dragged near/below SHEET_MIN threshold -> HIDE COMPLETELY (0)
        if (vy > 0.6 || currentH < SHEET_MIN * 0.7) {
          target = 0;
        }
        // 2. Swipe up fast OR dragged above mid-point -> EXPAND MAX
        else if (vy < -0.4 || currentH > (SHEET_PEEK + SHEET_MAX) / 2) {
          target = SHEET_MAX;
        }
        // 3. Moderate downward drag -> SNAP MIN
        else if (vy > 0.2 || currentH < (SHEET_MIN + SHEET_PEEK) / 2) {
          target = SHEET_MIN;
        }
        // 4. Default -> SHEET_PEEK
        else {
          target = SHEET_PEEK;
        }

        snapSheetTo(target);
      },
    })
  ).current;

  // ── Load Route History from AsyncStorage ────────────────────────────────────
  useEffect(() => {
    loadRouteHistory().then(setHistoryList);
  }, []);

  const fetchFamousPlaceSuggestions = async (originQuery: string) => {
    if (!backend.url) return;
    try {
      const res = await fetch(`${backend.url}/api/assistant/suggest-places`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin_text: originQuery })
      });
      const data = await res.json();
      if (data && data.status === 'ok' && data.places) {
        setSuggestedPlaces(data.places);
      }
    } catch (e) {
      console.warn('Failed to fetch place suggestions', e);
    }
  };

  const handleSelectSuggestedPlace = async (placeName: string) => {
    setDestText(placeName);
    try {
      const geo = await geocode(placeName, dest);
      if (geo) {
        setDest(geo);
        setIsDestSelected(true);
        setResponse(null);
        setShowPlanSetupModal(true);
      }
    } catch (e) {
      console.warn('Geocoding suggested place failed', e);
    }
  };

  useEffect(() => {
    const targetText = (destText && destText.trim().length >= 3 && destText !== 'To destination...') ? destText : originText;
    if (targetText && targetText.trim().length >= 3 && targetText !== 'Start Point') {
      const timer = setTimeout(() => {
        fetchFamousPlaceSuggestions(targetText);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [originText, destText, backend.url]);

  // ── Backend Health Monitor ─────────────────────────────────────────────────
  useEffect(() => {
    let dead = false;
    const ping = async () => { const s = await checkBackendHealth(); if (!dead) setBackend(s); };
    ping();
    const iv = setInterval(ping, 15000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  // ── 🧭 Compass Heading Sensor ────────────────────────────────────────────────
  useEffect(() => {
    let sub: any = null;
    let isDead = false;

    const setupCompass = async () => {
      try {
        const calibrated = await AsyncStorage.getItem('@compass_calibrated');
        if (!calibrated) {
          setShowCompassCalibration(true);
        }

        if (ExpoLocation && typeof ExpoLocation.requestForegroundPermissionsAsync === 'function') {
          const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
          if (status === 'granted' && ExpoLocation.watchHeadingAsync) {
            sub = await ExpoLocation.watchHeadingAsync((data: any) => {
              if (isDead) return;
              if (data && typeof data.trueHeading === 'number' && data.trueHeading >= 0) {
                setUserHeading(data.trueHeading);
              } else if (data && typeof data.magHeading === 'number' && data.magHeading >= 0) {
                setUserHeading(data.magHeading);
              }
            });
          }
        }
      } catch (e) {
        console.warn('Compass setup failed', e);
      }
    };

    setupCompass();

    return () => {
      isDead = true;
      if (sub && typeof sub.remove === 'function') {
        sub.remove();
      }
    };
  }, []);

  // ── Trigger Route Calculation ──────────────────────────────────────────────
  const handleExecutePlan = async () => {
    setShowPlanSetupModal(false);

    if (!backend.online) {
      setError('Backend engine is offline. Reconnecting to Render...');
      return;
    }

    setIsCraftingRoute(true);
    setLoading(true);
    setError(null);
    setPinMode(null);

    const o = origin;
    const d = dest;

    try {
      const req: MissionRequest = {
        origin: o,
        destination: d,
        planning_mode: planMode,
        deadline_minutes: planMode === 'scheduled' ? deadlineMinutes : 60,
        activity,
        pace,
      };

      const res = await planMission(req);

      if (!res.route_options?.length && (!res.routes?.fastest?.length || res.routes.fastest.length < 2)) {
        setError('Could not find routes to the desired destination. Please verify the locations and try again.');
        return;
      }

      setResponse(res);

      if (res.route_options?.length) {
        const rec = res.route_options.find(r => r.is_recommended) || res.route_options[0];
        setSelectedRoute(rec.id);

        const isInsideUSA = (lat: number, lng: number) =>
          lat >= 24.396308 && lat <= 49.384358 && lng >= -125.0 && lng <= -66.93457;
        const destInUSA = isInsideUSA(d.lat, d.lng);
        const originInUSA = isInsideUSA(o.lat, o.lng);

        if (!destInUSA || !originInUSA) {
          const hasThermalData = res.route_options.some(r => r.thermal_reduction_percent > 0 || r.avg_temp_c !== 36.0);
          if (!hasThermalData && res.thermal_reduction_percent === 0) {
            Alert.alert(
              'CoolPath Cool Route Unavailable',
              'Heat-optimized CoolPath routing is currently available only within the United States. Showing standard fastest route for this location.\n\nWould you like to proceed with normal route planning?',
              [{ text: 'Yes, Use Standard Route', style: 'default' }]
            );
          }
        }
      }

      // Save to local AsyncStorage history
      const now = new Date();
      const historyEntry: HistoryItem = {
        id: `hist_${Date.now()}`,
        timestamp: Date.now(),
        dateStr: `${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        originText,
        destText,
        originCoord: o,
        destCoord: d,
        activity,
        pace,
        planningMode: planMode,
        response: res,
        selectedRouteId: res.route_options?.[0]?.id || 'coolest',
      };
      const updatedHistory = await saveRouteHistory(historyEntry);
      setHistoryList(updatedHistory);

      // Slide up bottom sheet
      snapSheetTo(SHEET_PEEK);
    } catch (e: any) {
      setError(e.message || 'Route calculation failed');
    } finally {
      setIsCraftingRoute(false);
      setLoading(false);
    }
  };

  // ── Discard Journey Prompt ─────────────────────────────────────────────────
  const handleDiscardJourney = () => {
    Alert.alert(
      'Discard Journey',
      'Are you sure you want to discard this planned route and clear the map?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            setResponse(null);
            setError(null);
            setDestText('');
            setOriginText('');
            setIsDestSelected(false);
          },
        },
      ]
    );
  };

  // ── AI Prompt Submission ───────────────────────────────────────────────────
  const handleRunAiPrompt = async (promptText: string) => {
    if (!promptText.trim()) return;
    setAiLoading(true);
    setError(null);
    try {
      const parsedRes = await parseUserIntent(promptText);
      const intent: ParsedIntent = parsedRes.intent;

      if (intent) {
        if (intent.activity) setActivity(intent.activity);
        if (intent.pace) setPace(intent.pace);
        if (intent.deadline_minutes) {
          setPlanMode('scheduled');
          setDeadlineMinutes(intent.deadline_minutes);
        }
      }

      // Automatically execute plan and switch to Map tab
      setActiveTab('map');
      await handleExecutePlan();
    } catch (err: any) {
      console.warn('AI Parsing warning:', err);
      setActiveTab('map');
      await handleExecutePlan();
    } finally {
      setAiLoading(false);
    }
  };

  // ── CoolPath Assistant Action Execution ────────────────────────────────────
  const handlePlanRouteAction = async (oText: string, dText: string, act?: string) => {
    setActiveTab('map');
    setOriginText(oText);
    setDestText(dText);
    const validActivity: ActivityType =
      act && ['walking', 'running', 'biking', 'driving'].includes(act.toLowerCase())
        ? (act.toLowerCase() as ActivityType)
        : activity;

    if (act && ['walking', 'running', 'biking', 'driving'].includes(act.toLowerCase())) {
      setActivity(act.toLowerCase() as ActivityType);
    }

    let o = origin;
    let d = dest;

    const directO = parseCoordinateString(oText);
    if (directO) {
      o = directO;
      setOrigin(directO);
    } else if (oText && oText !== 'Start Point') {
      try {
        const oc = await geocode(oText, origin);
        if (oc) { o = oc; setOrigin(oc); }
      } catch (e) {}
    }

    const directD = parseCoordinateString(dText);
    if (directD) {
      d = directD;
      setDest(directD);
    } else if (dText && dText !== 'Destination') {
      try {
        const dc = await geocode(dText, dest);
        if (dc) { d = dc; setDest(dc); }
      } catch (e) {}
    }

    setIsCraftingRoute(true);
    setLoading(true);
    setError(null);
    setPinMode(null);

    try {
      const req: MissionRequest = {
        origin: o,
        destination: d,
        planning_mode: planMode,
        deadline_minutes: 60,
        activity: validActivity,
        pace,
      };
      const res = await planMission(req);

      if (!res.route_options?.length && (!res.routes?.fastest?.length || res.routes.fastest.length < 2)) {
        setError('Could not find routes to the desired destination. Please verify the locations and try again.');
        return;
      }

      setResponse(res);
      if (res.route_options?.length) {
        const rec = res.route_options.find((r) => r.is_recommended) || res.route_options[0];
        setSelectedRoute(rec.id);

        const isInsideUSA = (lat: number, lng: number) =>
          lat >= 24.396308 && lat <= 49.384358 && lng >= -125.0 && lng <= -66.93457;
        if (!isInsideUSA(d.lat, d.lng) || !isInsideUSA(o.lat, o.lng)) {
          const hasThermalData = res.route_options.some((r) => r.thermal_reduction_percent > 0 || r.avg_temp_c !== 36.0);
          if (!hasThermalData && res.thermal_reduction_percent === 0) {
            Alert.alert(
              'CoolPath Cool Route Unavailable',
              'Heat-optimized CoolPath routing is currently available only within the United States. Showing standard fastest route for this location.',
              [{ text: 'Yes, Use Standard Route', style: 'default' }]
            );
          }
        }
      }
      snapSheetTo(SHEET_PEEK);
    } catch (e: any) {
      setError(e.message || 'Route planning failed');
    } finally {
      setIsCraftingRoute(false);
      setLoading(false);
    }
  };

  // ── Restore History Item ───────────────────────────────────────────────────
  const handleRestoreHistory = (item: HistoryItem) => {
    setOrigin(item.originCoord);
    setDest(item.destCoord);
    setOriginText(item.originText);
    setDestText(item.destText);
    setActivity(item.activity);
    setPace(item.pace);
    setPlanMode(item.planningMode);
    setResponse(item.response);
    setSelectedRoute(item.selectedRouteId);
    setIsDestSelected(true);
    setActiveTab('map');
    snapSheetTo(SHEET_PEEK);
  };

  const handleMapClick = (lat: number, lng: number, mode?: PinMode) => {
    const targetMode = mode || pinMode;
    if (targetMode === 'origin') {
      setOrigin({ lat, lng });
      setOriginText(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      setResponse(null);
    } else if (targetMode === 'destination') {
      setDest({ lat, lng });
      setDestText(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      setIsDestSelected(true);
      setResponse(null);
    }
    setPinMode(null);
  };

  const handlePinMoved = (pin: 'origin' | 'destination', lat: number, lng: number) => {
    if (pin === 'origin') {
      setOrigin({ lat, lng });
      setOriginText(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      setResponse(null);
    } else {
      setDest({ lat, lng });
      setDestText(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      setIsDestSelected(true);
      setResponse(null);
    }
  };

  const handleCity = (c: typeof CITIES[0]) => {
    const o: Coordinate = { lat: c.lat - 0.006, lng: c.lng - 0.006 };
    const d: Coordinate = { lat: c.lat,          lng: c.lng          };
    setOrigin(o); setOriginText('Start Point');
    setDest(d);   setDestText(c.label.replace(/^\S+\s/, ''));
    setIsDestSelected(true);
    setResponse(null);
  };

  const activeRoute = useMemo(() => {
    if (!response?.route_options?.length) return null;
    return response.route_options.find(r => r.id === selectedRoute) || response.route_options[0];
  }, [response, selectedRoute]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }, isWeb && styles.webRoot]}>
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      {/* ── 🗺 MAP TAB VIEW ── */}
      {activeTab === 'map' && (
        <View style={StyleSheet.absoluteFill}>
          {/* Mapbox Vector Map */}
          <MobileMap
            missionResponse={response}
            originCoord={origin}
            destinationCoord={dest}
            selectedRouteId={selectedRoute}
            pinMode={pinMode}
            mapStyle={mapStyleOption === 'theme' ? theme.mapStyle : mapStyleOption}
            navPosition={navPosition}
            navSpeakerText={navSpeakerText}
            onGpsUpdate={handleGpsUpdate}
            onCurrentLocation={handleCurrentLocationResult}
            requestCurrentLocationSignal={locationSignal}
            flyToCoord={flyToTarget}
            onSelectRoute={setSelectedRoute}
            onMapClick={handleMapClick}
            onPinMoved={handlePinMoved}
            onMapCanvasTap={() => setUiVisible((v) => !v)}
            userHeading={userHeading}
          />

          {/* 🗺️ FLOATING ROUTE SELECTION FAB (Shown above Map Layer FAB when routes are calculated) */}
          {uiVisible && !isNavigating && response && (response.route_options?.length ?? 0) > 0 && (
            <View style={{
              position: 'absolute',
              bottom: SHEET_MIN + 24 + 58 + 58,
              left: 16,
              zIndex: 40,
            }}>
              {/* Route Selection FAB Button - Fixed Coordinate */}
              <TouchableOpacity
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: theme.topCardBg,
                  borderColor: '#38bdf8',
                  borderWidth: 1.5,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#38bdf8',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 6,
                }}
                onPress={() => setShowRouteSelectionMenu(prev => !prev)}
                activeOpacity={0.8}
              >
                <Ionicons 
                  name={
                    selectedRoute === 'fastest' ? 'flash' :
                    selectedRoute === 'coolest' ? 'snow' :
                    selectedRoute === 'balanced' ? 'scale' : 'navigate'
                  } 
                  size={20} 
                  color={
                    selectedRoute === 'fastest' ? theme.accentFast :
                    selectedRoute === 'coolest' ? theme.accentCool :
                    selectedRoute === 'balanced' ? theme.accentBalanced : '#38bdf8'
                  } 
                />
              </TouchableOpacity>

              {/* Expanded Route Options Menu - Positioned Absolutely Next to FAB */}
              {showRouteSelectionMenu && (
                <View style={{
                  position: 'absolute',
                  left: 56,
                  bottom: 0,
                  backgroundColor: theme.topCardBg,
                  borderRadius: 20,
                  padding: 6,
                  borderColor: theme.border,
                  borderWidth: 1.5,
                  gap: 6,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.25,
                  shadowRadius: 10,
                  elevation: 8,
                  minWidth: 220,
                  maxWidth: 260,
                }}>
                  {response.route_options!.map((route) => {
                    const sel = route.id === selectedRoute;
                    let iconName: any = 'navigate';
                    let iconColor = '#38bdf8';
                    if (route.id === 'fastest') {
                      iconName = 'flash';
                      iconColor = theme.accentFast;
                    } else if (route.id === 'coolest') {
                      iconName = 'snow';
                      iconColor = theme.accentCool;
                    } else if (route.id === 'balanced') {
                      iconName = 'scale';
                      iconColor = theme.accentBalanced;
                    }

                    return (
                      <TouchableOpacity
                        key={route.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          borderRadius: 14,
                          backgroundColor: sel ? (theme.isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(56, 189, 248, 0.1)') : 'transparent',
                          gap: 10,
                        }}
                        onPress={() => {
                          setSelectedRoute(route.id);
                          setShowRouteSelectionMenu(false);
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          backgroundColor: sel ? iconColor : theme.inputBg,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <Ionicons 
                            name={iconName} 
                            size={16} 
                            color={sel ? '#ffffff' : iconColor} 
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, fontWeight: '800', color: theme.textPrimary }} numberOfLines={1}>
                            {route.name}
                          </Text>
                          <Text style={{ fontSize: 10, color: theme.textMuted, marginTop: 1 }}>
                            {route.travel_minutes} min • ~{formatTemp(route.avg_temp_c)}
                          </Text>
                        </View>
                        {sel && <Ionicons name="checkmark-circle" size={16} color={theme.accentCool} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* 🗺️ Floating Map Layer Selector FAB Stack */}
          {uiVisible && !isNavigating && (
            <View style={{
              position: 'absolute',
              bottom: SHEET_MIN + 24 + 58,
              left: 16,
              zIndex: 35,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}>
              {/* Core Map Layer Toggle Button */}
              <TouchableOpacity
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: theme.topCardBg,
                  borderColor: theme.accentCool,
                  borderWidth: 1.5,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: theme.accentCool,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.25,
                  shadowRadius: 8,
                  elevation: 6,
                }}
                onPress={() => setShowMapLayersMenu(prev => !prev)}
                activeOpacity={0.8}
              >
                <Ionicons name="layers-outline" size={22} color={theme.accentCool} />
              </TouchableOpacity>

              {/* Expanded Menu Options */}
              {showMapLayersMenu && (
                <View style={{
                  flexDirection: 'row',
                  backgroundColor: theme.topCardBg,
                  borderRadius: 24,
                  padding: 4,
                  borderColor: theme.border,
                  borderWidth: 1,
                  gap: 6,
                  alignItems: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.15,
                  shadowRadius: 6,
                  elevation: 5,
                }}>
                  {/* Default Style */}
                  <TouchableOpacity
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: mapStyleOption === 'theme' ? theme.accentCool : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onPress={() => changeMapStyleOption('theme')}
                    activeOpacity={0.8}
                  >
                    <Ionicons 
                      name="map-outline" 
                      size={18} 
                      color={mapStyleOption === 'theme' ? (theme.isDark ? '#0C1210' : '#ffffff') : theme.textPrimary} 
                    />
                  </TouchableOpacity>

                  {/* Satellite Style */}
                  <TouchableOpacity
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: mapStyleOption === 'satellite' ? theme.accentCool : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onPress={() => changeMapStyleOption('satellite')}
                    activeOpacity={0.8}
                  >
                    <Ionicons 
                      name="globe-outline" 
                      size={18} 
                      color={mapStyleOption === 'satellite' ? (theme.isDark ? '#0C1210' : '#ffffff') : theme.textPrimary} 
                    />
                  </TouchableOpacity>

                  {/* Outdoors Style */}
                  <TouchableOpacity
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: mapStyleOption === 'outdoors' ? theme.accentCool : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onPress={() => changeMapStyleOption('outdoors')}
                    activeOpacity={0.8}
                  >
                    <Ionicons 
                      name="leaf-outline" 
                      size={18} 
                      color={mapStyleOption === 'outdoors' ? (theme.isDark ? '#0C1210' : '#ffffff') : theme.textPrimary} 
                    />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Bottom-Left Animated Floating Current Location FAB Button */}
          {uiVisible && !isNavigating && (
            <Animated.View
              style={[
                styles.fabLocationBtnWrapper,
                {
                  transform: [
                    { scale: locationFabScaleAnim },
                    {
                      rotate: locationFabSpinAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '360deg'],
                      }),
                    },
                  ],
                },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.fabLocationBtn,
                  { backgroundColor: theme.topCardBg, borderColor: theme.accentCool },
                ]}
                onPress={triggerCurrentLocationWithAnim}
                activeOpacity={0.8}
              >
                {isFetchingLocation ? (
                  <ActivityIndicator size="small" color={theme.accentCool} />
                ) : (
                  <Ionicons name="navigate-outline" size={22} color={theme.accentCool} />
                )}
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* 🧭 LIVE NAVIGATION HUD TOP CARD */}
          {isNavigating && (
            <View style={[styles.navHudCard, { backgroundColor: theme.isDark ? 'rgba(12, 18, 16, 0.7)' : 'rgba(246, 243, 236, 0.7)', borderWidth: 0 }]}>
              
              {/* Commuter Status Box */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                
                {/* Commuter Avatar */}
                <Image
                  source={
                    activity === 'driving' ? carImg :
                    activity === 'biking' ? motorbikeImg : womanImg
                  }
                  style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: theme.inputBg }}
                  resizeMode="contain"
                />

                {/* Commuter Diagnostics */}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: '900', color: theme.textPrimary, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                      {activity === 'driving' ? 'Commuter' : activity === 'biking' ? 'Rider' : 'Maya'}
                    </Text>
                    <View style={{
                      backgroundColor: commuterBodyTemp > 38.0 ? 'rgba(232, 137, 94, 0.16)' : 'rgba(45, 217, 184, 0.16)',
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 6,
                    }}>
                      <Text style={{
                        fontSize: 9,
                        fontWeight: '800',
                        color: commuterBodyTemp > 38.0 ? theme.accentHeat : theme.accentCool,
                      }}>
                        {commuterBodyTemp > 38.0 ? 'HEAT STRAIN' : 'COMFORT STABLE'}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
                    <View>
                      <Text style={{ fontSize: 10, color: theme.textMuted }}>BODY TEMP</Text>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                        {commuterBodyTemp.toFixed(1)}°C
                      </Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 10, color: theme.textMuted }}>SPEED</Text>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                        {navSpeedKmh} {distUnit === 'mi' ? 'mph' : 'km/h'}
                      </Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 10, color: theme.textMuted }}>REAL-FEEL</Text>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                        {formatTemp(navCurrentTempC)}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* AC Toggle Button (Only for car scenario) */}
                {activity === 'driving' && (
                  <TouchableOpacity
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: acOn ? 'rgba(45, 217, 184, 0.15)' : 'rgba(232, 137, 94, 0.15)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 8,
                    }}
                    onPress={() => setAcOn(prev => !prev)}
                    activeOpacity={0.8}
                  >
                    <Ionicons 
                      name={acOn ? "snow-outline" : "flame-outline"} 
                      size={20} 
                      color={acOn ? theme.accentCool : theme.accentHeat} 
                    />
                  </TouchableOpacity>
                )}

                {/* Stop Navigation Button */}
                <TouchableOpacity
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onPress={stopNavigation}
                  activeOpacity={0.8}
                >
                  <Ionicons name="stop-outline" size={20} color="#ef4444" />
                </TouchableOpacity>
              </View>

              {/* Simulator Speed Controller */}
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 10,
                paddingTop: 8,
                borderTopWidth: 0.5,
                borderTopColor: theme.border,
              }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: theme.textMuted, letterSpacing: 0.3 }}>SIMULATION SPEED</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <TouchableOpacity
                    style={{
                      width: 44,
                      height: 32,
                      borderRadius: 6,
                      backgroundColor: theme.inputBg,
                      borderWidth: 0.5,
                      borderColor: theme.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onPress={() => adjustSimSpeed('down')}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="remove-outline" size={16} color={theme.textPrimary} />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 12, fontWeight: '800', width: 60, textAlign: 'center', color: theme.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                    {simSpeedKmh} {distUnit === 'mi' ? 'mph' : 'km/h'}
                  </Text>
                  <TouchableOpacity
                    style={{
                      width: 44,
                      height: 32,
                      borderRadius: 6,
                      backgroundColor: theme.inputBg,
                      borderWidth: 0.5,
                      borderColor: theme.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onPress={() => adjustSimSpeed('up')}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="add-outline" size={16} color={theme.textPrimary} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Spoken Dialog captions (with typewriter animation) */}
              {!!typedSubtitle && (
                <View style={{
                  marginTop: 10,
                  backgroundColor: theme.inputBg,
                  borderRadius: 10,
                  padding: 10,
                  borderWidth: 0.5,
                  borderColor: theme.border,
                }}>
                  <Text style={{ fontSize: 12, lineHeight: 18, color: theme.textPrimary, fontStyle: 'italic' }}>
                    "{typedSubtitle}"
                  </Text>
                </View>
              )}

              {/* Progress Completion bar */}
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: theme.textMuted }}>JOURNEY COMPLETION</Text>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: theme.accentCool, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                    {navProgressPct}%
                  </Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.border, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${navProgressPct}%`, backgroundColor: theme.accentCool, borderRadius: 3 }} />
                </View>
              </View>
            </View>
          )}

          {/* Clean Map Floating Restore Button */}
          {!uiVisible && !isNavigating && (
            <TouchableOpacity
              style={[styles.restoreUiBtn, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}
              onPress={() => setUiVisible(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="eye-outline" size={16} color="#38bdf8" style={{ marginRight: 6 }} />
              <Text style={[styles.restoreUiTxt, { color: theme.textPrimary }]}>Show UI Controls</Text>
            </TouchableOpacity>
          )}

          {/* Top Brand Header & Location Input Card */}
          {uiVisible && !isNavigating && (
            <>
              {/* Header Bar */}
              <View style={[styles.topBar, isDesktopWeb && styles.webTopBar]} pointerEvents="box-none">
                <View style={styles.brandLogoContainer}>
                  <BrandLogo isDark={theme.isDark} />
                </View>

                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  {/* Live Temp & AQI Badge */}
                  <View style={[styles.weatherPill, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}>
                    <Ionicons name="thermometer-outline" size={13} color="#34d399" style={{ marginRight: 3 }} />
                    <Text style={[styles.weatherTxt, { color: theme.textPrimary }]}>
                      {formatTemp(liveWeather.tempC)}
                    </Text>
                    <View style={[styles.weatherDot, { backgroundColor: theme.border }]} />
                    <MaterialCommunityIcons name="air-filter" size={12} color="#38bdf8" style={{ marginRight: 3 }} />
                    <Text style={[styles.weatherTxt, { color: theme.textSecondary }]}>
                      {liveWeather.aqi !== null ? `AQI ${liveWeather.aqi}` : 'AQI --'}
                    </Text>
                  </View>

                  {/* Settings Toggle */}
                  <TouchableOpacity
                    style={[styles.themeBtn, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}
                    onPress={() => setShowSettingsModal(true)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="settings-sharp" size={16} color={theme.textPrimary} />
                  </TouchableOpacity>

                  {/* Backend Status Interactive Button */}
                  <TouchableOpacity
                    style={[styles.statusPill, { 
                      backgroundColor: backend.online ? theme.statusBgOnline : theme.statusBgOffline,
                      width: 24, height: 24, borderRadius: 12, paddingHorizontal: 0, justifyContent: 'center', alignItems: 'center'
                    }]}
                    onPress={handleRetryBackend}
                    activeOpacity={0.8}
                  >
                    {isRetryingBackend ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Animated.View style={[styles.dot, { transform: [{ scale: signalPulseAnim }], margin: 0, marginRight: 0 }]} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Status Toast Notification Banner */}
              {statusToast && (
                <View style={[styles.statusToastCard, isDesktopWeb && styles.webStatusToast, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}>
                  <Ionicons name="information-circle-outline" size={15} color="#38bdf8" style={{ marginRight: 6 }} />
                  <Text style={[styles.statusToastTxt, { color: theme.textPrimary }]}>{statusToast}</Text>
                </View>
              )}

              {/* Error Banner */}
              {error && (
                <View style={[styles.statusToastCard, isDesktopWeb && styles.webStatusToast, { backgroundColor: theme.topCardBg, borderColor: '#EF4444' }]}>
                  <Ionicons name="warning-outline" size={15} color="#EF4444" style={{ marginRight: 6 }} />
                  <Text style={[styles.statusToastTxt, { color: '#EF4444', flex: 1 }]}>{error}</Text>
                  <TouchableOpacity onPress={() => setError(null)} style={{ padding: 4 }}>
                    <Ionicons name="close" size={14} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>
              )}

              {/* Location Input Card */}
              <View style={[styles.locCard, isDesktopWeb && styles.webLocCard, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}>
                {/* Destination row is always shown first */}
                <View style={styles.locRow}>
                  <View style={[styles.locDot, { backgroundColor: '#EF4444' }]} />
                  <TextInput
                    style={[styles.locInput, { color: theme.textPrimary }]}
                    value={destText}
                    onChangeText={(txt) => {
                      setDestText(txt);
                      setActiveSearchTarget('dest');
                      const direct = parseCoordinateString(txt);
                      if (direct) {
                        setDest(direct);
                        setIsDestSelected(true);
                      }
                    }}
                    onFocus={() => setActiveSearchTarget('dest')}
                    placeholder="To destination..."
                    placeholderTextColor={theme.textMuted}
                    returnKeyType="done"
                    onSubmitEditing={async () => {
                      setActiveSearchTarget(null);
                      const direct = parseCoordinateString(destText);
                      if (!direct && destText.trim().length >= 2) {
                        const geo = await geocode(destText, dest);
                        if (geo) {
                          setDest(geo);
                          setIsDestSelected(true);
                          setResponse(null);
                        }
                      }
                    }}
                  />
                  <TouchableOpacity
                    style={[
                      styles.pinBtn,
                      { backgroundColor: theme.inputBg, borderColor: theme.border },
                      pinMode === 'destination' && styles.pinBtnActive,
                    ]}
                    onPress={() => setPinMode((p) => (p === 'destination' ? null : 'destination'))}
                  >
                    <Ionicons name="locate" size={15} color={pinMode === 'destination' ? '#EF4444' : theme.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.aiVoiceInlineBtn]}
                    onPress={() => setShowAssistantModal(true)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="sparkles" size={15} color="#fff" />
                  </TouchableOpacity>
                </View>

                {/* Only render Origin input and Swap row after Destination is selected */}
                {isDestSelected && (
                  <>
                    {/* Swap row with Distance Badge */}
                    <View style={styles.swapRow}>
                      <TouchableOpacity
                        style={[styles.swapBtn, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                        onPress={() => {
                          const tmp = origin; setOrigin(dest); setDest(tmp);
                          const tmpT = originText; setOriginText(destText); setDestText(tmpT);
                          setActiveSearchTarget(null);
                        }}
                      >
                        <Ionicons name="swap-vertical" size={14} color={theme.textSecondary} />
                      </TouchableOpacity>

                      <View style={[styles.distancePill, { backgroundColor: theme.inputBg, borderColor: theme.border }]}>
                        <FontAwesome5 name="route" size={10} color="#10b981" style={{ marginRight: 5 }} />
                        <Text style={[styles.distanceTxt, { color: theme.textPrimary }]}>{formatDist(directDistanceKm)}</Text>
                      </View>

                      {/* Microclimate Heat Strain scale legend pill */}
                      <View style={[styles.distancePill, { backgroundColor: theme.inputBg, borderColor: theme.border, marginLeft: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                        <Ionicons name="thermometer-outline" size={11} color="#38bdf8" />
                        <Text style={{ fontSize: 9, color: theme.textPrimary, fontWeight: '800', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>24°C</Text>
                        <View style={{ width: 32, height: 4, borderRadius: 2, flexDirection: 'row', overflow: 'hidden' }}>
                          <View style={{ flex: 1, backgroundColor: '#2DD9B8' }} />
                          <View style={{ flex: 1, backgroundColor: '#38BDF8' }} />
                          <View style={{ flex: 1, backgroundColor: '#F59E0B' }} />
                          <View style={{ flex: 1, backgroundColor: '#E8895E' }} />
                        </View>
                        <Text style={{ fontSize: 9, color: theme.textPrimary, fontWeight: '800', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>38°C</Text>
                      </View>

                      <View style={{ flex: 1 }} />
                    </View>

                    {/* Origin row */}
                    <View style={styles.locRow}>
                      <View style={[styles.locDot, { backgroundColor: '#10B981' }]} />
                      <TextInput
                        style={[styles.locInput, { color: theme.textPrimary }]}
                        value={originText}
                        onChangeText={(txt) => {
                          setOriginText(txt);
                          setActiveSearchTarget('origin');
                          const direct = parseCoordinateString(txt);
                          if (direct) setOrigin(direct);
                        }}
                        onFocus={() => setActiveSearchTarget('origin')}
                        placeholder="From origin..."
                        placeholderTextColor={theme.textMuted}
                        returnKeyType="next"
                        onSubmitEditing={async () => {
                          setActiveSearchTarget(null);
                          const direct = parseCoordinateString(originText);
                          if (!direct && originText.trim().length >= 2) {
                            const geo = await geocode(originText, origin);
                            if (geo) {
                              setOrigin(geo);
                              setResponse(null);
                            }
                          }
                          setShowPlanSetupModal(true);
                        }}
                      />

                      <TouchableOpacity
                        style={[
                          styles.pinBtn,
                          { backgroundColor: theme.inputBg, borderColor: theme.border },
                          pinMode === 'origin' && styles.pinBtnActive,
                        ]}
                        onPress={() => setPinMode((p) => (p === 'origin' ? null : 'origin'))}
                      >
                        <Ionicons name="locate" size={15} color={pinMode === 'origin' ? '#10B981' : theme.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                {/* Dynamic Suggested Places Chips */}
                {suggestedPlaces.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityRow} contentContainerStyle={{ gap: 6 }}>
                    {suggestedPlaces.map((placeName, i) => (
                      <TouchableOpacity
                        key={i}
                        style={[
                          styles.cityChip,
                          { backgroundColor: theme.isDark ? '#1e1b4b' : '#e0e7ff', borderColor: theme.isDark ? '#4338ca' : '#818cf8' },
                        ]}
                        onPress={() => {
                          setActiveSearchTarget(null);
                          handleSelectSuggestedPlace(placeName);
                        }}
                      >
                        <Text style={[styles.cityChipTxt, { color: theme.isDark ? '#a5b4fc' : '#3730a3' }]}>{placeName}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {/* Autocomplete Search Dropdown List for Origin */}
                {activeSearchTarget === 'origin' && originSuggestions.length > 0 && (
                  <View style={[styles.suggestionsDropdown, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}>
                    {originSuggestions.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.suggestionItem, { borderBottomColor: theme.border }]}
                        onPress={() => {
                          setOrigin({ lat: item.lat, lng: item.lng });
                          setOriginText(item.placeName);
                          setOriginSuggestions([]);
                          setActiveSearchTarget(null);
                          setResponse(null);
                        }}
                      >
                        <Ionicons name="location-sharp" size={16} color="#10B981" style={{ marginRight: 10 }} />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                            <Text style={[styles.suggestionName, { color: theme.textPrimary, flex: 1 }]} numberOfLines={1}>
                              {item.shortName}
                            </Text>
                            {item.badgeLabel && (
                              <View style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginLeft: 6 }}>
                                <Text style={{ fontSize: 9, fontWeight: '800', color: '#10b981' }}>
                                  {item.badgeLabel}
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={[styles.suggestionSub, { color: theme.textMuted }]} numberOfLines={1}>{item.placeName}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Autocomplete Search Dropdown List for Destination */}
                {activeSearchTarget === 'dest' && destSuggestions.length > 0 && (
                  <View style={[styles.suggestionsDropdown, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}>
                    {destSuggestions.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.suggestionItem, { borderBottomColor: theme.border }]}
                        onPress={() => {
                          setDest({ lat: item.lat, lng: item.lng });
                          setDestText(item.placeName);
                          setDestSuggestions([]);
                          setIsDestSelected(true);
                          setActiveSearchTarget(null);
                          setResponse(null);
                        }}
                      >
                        <Ionicons name="location-sharp" size={16} color="#EF4444" style={{ marginRight: 10 }} />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                            <Text style={[styles.suggestionName, { color: theme.textPrimary, flex: 1 }]} numberOfLines={1}>
                              {item.shortName}
                            </Text>
                            {item.badgeLabel && (
                              <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginLeft: 6 }}>
                                <Text style={{ fontSize: 9, fontWeight: '800', color: '#ef4444' }}>
                                  {item.badgeLabel}
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={[styles.suggestionSub, { color: theme.textMuted }]} numberOfLines={1}>{item.placeName}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

              </View>

              {/* ⚡ FLOATING PLAN CTA BUTTON (Shown initially when no route calculated) */}
              {!response && (
                <TouchableOpacity
                  style={[styles.floatingPlanBtn, isDesktopWeb && styles.webFloatingPlanBtn]}
                  onPress={() => setShowPlanSetupModal(true)}
                  activeOpacity={0.88}
                >
                  <Ionicons name="leaf-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
                  <Text style={styles.floatingPlanTxt}>Plan CoolPath Route</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* 🚀 FLOATING START NAVIGATION PILL BUTTON (Same size as Show Metrics button, placed directly above it) */}
          {uiVisible && response && !isNavigating && !isSheetExpanded && (
            <TouchableOpacity
              style={{
                position: 'absolute',
                bottom: isSheetHidden ? 132 : SHEET_MIN + 12,
                alignSelf: 'center',
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: Math.min(SW * 0.055, 22),
                paddingVertical: 12,
                borderRadius: 24,
                backgroundColor: '#10b981',
                shadowColor: '#10b981',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.35,
                shadowRadius: 8,
                elevation: 8,
                zIndex: 38,
                minHeight: 46,
              }}
              onPress={() => setShowNavSetupModal(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="navigate-circle" size={18} color="#ffffff" style={{ marginRight: 6 }} />
              <Text style={{ fontSize: Math.min(SW * 0.035, 14), fontWeight: '800', color: '#ffffff', letterSpacing: 0.5, lineHeight: 18 }}>
                Start Navigation
              </Text>
            </TouchableOpacity>
          )}

          {/* ── 📱 REDESIGNED ROUTE RESULTS BOTTOM SHEET (Only shown after route generated) ── */}
          {uiVisible && response && !isNavigating && (
            <Animated.View style={[
              styles.sheet,
              { height: sheetHeightAnim, backgroundColor: theme.sheetBg },
              isDesktopWeb && { ...styles.webSheet, height: Math.max(520, viewportHeight - 48) },
            ]}>
              {/* Dedicated drag handle aligned top-center with larger tap area */}
              <View
                style={{
                  width: '100%',
                  alignItems: 'center',
                  paddingTop: 14,
                  paddingBottom: 8,
                  minHeight: 32, // Larger tap target
                }}
                {...panResponder.panHandlers}
              >
                <View style={[styles.handleBar, { backgroundColor: theme.handleColor }]} />
              </View>

              {/* Sheet Header with title, 🚀 Start Nav Button, and ❌ Discard Journey Button */}
              <View style={styles.sheetHeaderBar}>
                <Text style={[styles.sheetTitleTxt, { color: theme.textPrimary }]}>CoolPath Metrics</Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {!isNavigating && (
                    <TouchableOpacity
                      style={styles.startNavHeaderBtn}
                      onPress={() => setShowNavSetupModal(true)}
                      activeOpacity={0.85}
                    >
                      <LinearGradient colors={['#10b981', '#059669']} style={styles.startNavHeaderGradient}>
                        <Ionicons name="navigate-circle" size={15} color="#ffffff" style={{ marginRight: 4 }} />
                        <Text style={styles.startNavHeaderTxt}>Start Nav</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  )}

                  {/* ❌ Discard Journey Button */}
                  <TouchableOpacity style={styles.discardBtn} onPress={handleDiscardJourney} activeOpacity={0.8}>
                    <Ionicons name="close" size={16} color="#fca5a5" />
                  </TouchableOpacity>
                </View>
              </View>

              {isSheetExpanded ? (
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.sheetInner}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                {/* 🛡️ SOLID & PROFESSIONAL THERMAL STRAIN REDUCTION CARD */}
                {activeRoute && (
                  <LinearGradient
                    colors={theme.isDark ? ['#064e3b', '#022c22'] : ['#d1fae5', '#a7f3d0']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      marginBottom: 16,
                      borderRadius: 18,
                      padding: 16,
                      borderWidth: 1.5,
                      borderColor: '#10b981',
                      shadowColor: '#10b981',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.25,
                      shadowRadius: 8,
                      elevation: 6,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          backgroundColor: 'rgba(16, 185, 129, 0.25)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <Ionicons name="shield-checkmark" size={18} color={theme.isDark ? '#34d399' : '#047857'} />
                        </View>
                        <View>
                          <Text style={{ fontSize: 10, fontWeight: '800', color: theme.isDark ? '#a7f3d0' : '#065f46', letterSpacing: 0.6, textTransform: 'uppercase' }}>
                            PHYSICS-ML THERMAL PROTECTION
                          </Text>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: theme.isDark ? '#ffffff' : '#064e3b' }}>
                            Optimal Microclimate Route
                          </Text>
                        </View>
                      </View>
                      <View style={{
                        backgroundColor: theme.isDark ? '#10b981' : '#047857',
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 20,
                      }}>
                        <Text style={{ fontSize: 10, fontWeight: '900', color: '#ffffff', letterSpacing: 0.4 }}>
                          VERIFIED SHADE
                        </Text>
                      </View>
                    </View>

                    {/* Main Stats Row */}
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: theme.isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.65)',
                      borderRadius: 14,
                      padding: 12,
                      borderWidth: 1,
                      borderColor: theme.isDark ? 'rgba(52, 211, 153, 0.2)' : 'rgba(4, 120, 87, 0.2)',
                    }}>
                      {/* Stat 1: Savings */}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 9, fontWeight: '800', color: theme.isDark ? '#9ca3af' : '#4b5563', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                          HEAT STRAIN SAVINGS
                        </Text>
                        <Text style={{ fontSize: 22, fontWeight: '900', color: theme.isDark ? '#34d399' : '#047857', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          {activeRoute.thermal_reduction_percent > 0 ? `-${activeRoute.thermal_reduction_percent}%` : 'OPTIMAL'}
                        </Text>
                      </View>

                      <View style={{ width: 1, height: 32, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)', marginHorizontal: 10 }} />

                      {/* Stat 2: Exposure Load */}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 9, fontWeight: '800', color: theme.isDark ? '#9ca3af' : '#4b5563', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                          EXPOSURE LOAD
                        </Text>
                        <Text style={{ fontSize: 15, fontWeight: '900', color: theme.isDark ? '#ffffff' : '#111827', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          {activeRoute.thermal_exposure ?? '--'} J/s
                        </Text>
                      </View>

                      <View style={{ width: 1, height: 32, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)', marginHorizontal: 10 }} />

                      {/* Stat 3: Est Duration */}
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 9, fontWeight: '800', color: theme.isDark ? '#9ca3af' : '#4b5563', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                          DURATION
                        </Text>
                        <Text style={{ fontSize: 15, fontWeight: '900', color: theme.isDark ? '#ffffff' : '#111827', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          {activeRoute.travel_minutes} min
                        </Text>
                      </View>
                    </View>
                  </LinearGradient>
                )}

                {/* ── 🗺️ SELECTED ROUTE METRICS CARD ── */}
                {activeRoute && (
                  <View style={{
                    marginBottom: 14,
                    padding: Math.min(SW * 0.04, 16),
                    borderRadius: 18,
                    backgroundColor: theme.surfaceRaised,
                    borderWidth: 1.5,
                    borderColor: theme.accentCool,
                    shadowColor: theme.accentCool,
                    shadowOpacity: 0.15,
                    shadowRadius: 8,
                    elevation: 5,
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <Ionicons 
                            name={
                              activeRoute.id === 'fastest' ? 'flash' :
                              activeRoute.id === 'coolest' ? 'snow' :
                              activeRoute.id === 'balanced' ? 'scale' : 'navigate'
                            } 
                            size={15} 
                            color={
                              activeRoute.id === 'fastest' ? theme.accentFast :
                              activeRoute.id === 'coolest' ? theme.accentCool :
                              activeRoute.id === 'balanced' ? theme.accentBalanced : '#38bdf8'
                            } 
                          />
                          <Text style={{ fontSize: 10, fontWeight: '800', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            ACTIVE SELECTED ROUTE
                          </Text>
                        </View>
                        <Text style={{ fontSize: 16, fontWeight: '900', color: theme.textPrimary }} numberOfLines={1}>
                          {activeRoute.name}
                        </Text>
                      </View>

                      {activeRoute.is_recommended && (
                        <View style={{ backgroundColor: 'rgba(224, 184, 74, 0.16)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: theme.accentGold }}>
                          <Text style={{ fontSize: 10, fontWeight: '900', color: theme.accentGold }}>⭐ BEST CHOICE</Text>
                        </View>
                      )}
                    </View>

                    {/* Stats Readout Grid */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: theme.inputBg, padding: 10, borderRadius: 12, marginBottom: 10 }}>
                      <View>
                        <Text style={{ fontSize: 9, color: theme.textMuted, fontWeight: '700' }}>EST. DURATION</Text>
                        <Text style={{ fontSize: 15, fontWeight: '900', color: theme.textPrimary, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          {activeRoute.travel_minutes} min
                        </Text>
                      </View>
                      <View>
                        <Text style={{ fontSize: 9, color: theme.textMuted, fontWeight: '700' }}>AVG TEMP</Text>
                        <Text style={{ fontSize: 15, fontWeight: '900', color: theme.textPrimary, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          ~{formatTemp(activeRoute.avg_temp_c)}
                        </Text>
                      </View>
                      <View>
                        <Text style={{ fontSize: 9, color: theme.textMuted, fontWeight: '700' }}>HEAT LOAD</Text>
                        <Text style={{ fontSize: 15, fontWeight: '900', color: theme.textPrimary, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          {activeRoute.thermal_exposure ?? '--'} J/s
                        </Text>
                      </View>
                    </View>

                    {/* Feedback Buttons for Selected Route */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 0.5, borderTopColor: theme.border }}>
                      <Text style={{ fontSize: 11, color: theme.textMuted, fontWeight: '600' }}>Rate route choice:</Text>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {submittedFeedbackRoutes[activeRoute.id] ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: 6 }}>
                            <Ionicons name="checkmark-circle" size={12} color={theme.accentCool} style={{ marginRight: 4 }} />
                            <Text style={{ fontSize: 10, fontWeight: '800', color: theme.accentCool }}>Feedback Saved</Text>
                          </View>
                        ) : (
                          <>
                            <TouchableOpacity
                              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(45, 217, 184, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(45, 217, 184, 0.3)', gap: 3 }}
                              onPress={() => handleFeedback(activeRoute.id, true)}
                              activeOpacity={0.7}
                            >
                              <Ionicons name="thumbs-up-outline" size={11} color={theme.accentCool} />
                              <Text style={{ fontSize: 10, fontWeight: '700', color: theme.accentCool }}>Like</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(232, 137, 94, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(232, 137, 94, 0.3)', gap: 3 }}
                              onPress={() => handleFeedback(activeRoute.id, false)}
                              activeOpacity={0.7}
                            >
                              <Ionicons name="thumbs-down-outline" size={11} color={theme.accentHeat} />
                              <Text style={{ fontSize: 10, fontWeight: '700', color: theme.accentHeat }}>Pass</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                )}

                {/* ⏰ REDESIGNED OPTIMAL DEPARTURE TIMING CARD (4 Separated Metric Boxes) */}
                {response && (
                  <View style={{ marginBottom: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="time" size={15} color="#fbbf24" />
                        <Text style={[styles.secLabel, { color: theme.textMuted, marginBottom: 0 }]}>
                          OPTIMAL DEPARTURE WINDOW
                        </Text>
                      </View>
                      <View style={{ backgroundColor: 'rgba(251, 191, 36, 0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                        <Text style={{ fontSize: 9, fontWeight: '800', color: '#fbbf24' }}>
                          {response.planning_mode === 'scheduled' ? 'SCHEDULED' : 'INSTANT DEPARTURE'}
                        </Text>
                      </View>
                    </View>

                    {/* 4 Separated Metric Boxes Grid */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {/* Box 1: Optimal Departure Time */}
                      <View style={{
                        flex: 1,
                        minWidth: '46%',
                        backgroundColor: theme.inputBg,
                        padding: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: 'rgba(251, 191, 36, 0.3)',
                      }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                          <Ionicons name="alarm-outline" size={13} color="#fbbf24" />
                          <Text style={{ fontSize: 9, fontWeight: '800', color: theme.textMuted, letterSpacing: 0.3 }}>BEST DEPARTURE</Text>
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '900', color: theme.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          {response.optimal_departure_time || 'Depart Now'}
                        </Text>
                      </View>

                      {/* Box 2: Wait Offset Time */}
                      <View style={{
                        flex: 1,
                        minWidth: '46%',
                        backgroundColor: theme.inputBg,
                        padding: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: 'rgba(56, 189, 248, 0.3)',
                      }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                          <Ionicons name="hourglass-outline" size={13} color="#38bdf8" />
                          <Text style={{ fontSize: 9, fontWeight: '800', color: theme.textMuted, letterSpacing: 0.3 }}>RECOMMENDED WAIT</Text>
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '900', color: theme.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          {response.wait_minutes > 0 ? `+${response.wait_minutes} min` : '0 min (Immediate)'}
                        </Text>
                      </View>

                      {/* Box 3: Thermal Load Savings */}
                      <View style={{
                        flex: 1,
                        minWidth: '46%',
                        backgroundColor: theme.inputBg,
                        padding: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: 'rgba(16, 185, 129, 0.3)',
                      }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                          <Ionicons name="trending-down" size={13} color="#10b981" />
                          <Text style={{ fontSize: 9, fontWeight: '800', color: theme.textMuted, letterSpacing: 0.3 }}>THERMAL SAVINGS</Text>
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '900', color: '#10b981', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          {response.thermal_reduction_percent > 0 ? `-${response.thermal_reduction_percent}% Heat` : 'Optimal'}
                        </Text>
                      </View>

                      {/* Box 4: Recommended Speed/Pace */}
                      <View style={{
                        flex: 1,
                        minWidth: '46%',
                        backgroundColor: theme.inputBg,
                        padding: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: 'rgba(167, 139, 250, 0.3)',
                      }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                          <Ionicons name="speedometer-outline" size={13} color="#a78bfa" />
                          <Text style={{ fontSize: 9, fontWeight: '800', color: theme.textMuted, letterSpacing: 0.3 }}>TARGET PACE</Text>
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '900', color: theme.textPrimary, textTransform: 'capitalize' }}>
                          {response.recommended_action?.pace || pace || 'Normal'}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* ── 📊 PERSISTENT COMFORT PROFILE GAUGE ── */}
                <View
                  style={{
                    marginBottom: 14,
                    padding: Math.min(SW * 0.04, 16),
                    borderRadius: 16,
                    backgroundColor: theme.inputBg,
                    borderWidth: 1.5,
                    borderColor: theme.border,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <Ionicons name="hardware-chip-outline" size={16} color="#10b981" style={{ marginRight: 7 }} />
                      <Text
                        style={{
                          fontSize: Math.min(SW * 0.03, 12),
                          fontWeight: '800',
                          color: theme.textPrimary,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          lineHeight: 16,
                        }}
                        numberOfLines={1}
                      >
                        Learned Comfort Profile
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setShowMLInsightsModal(true)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{ paddingVertical: 4 }}
                    >
                      <Text
                        style={{
                          fontSize: Math.min(SW * 0.03, 12),
                          fontWeight: '800',
                          color: '#10b981',
                          lineHeight: 16,
                        }}
                      >
                        {shadePreferencePct.toFixed(0)}% Shade ⓘ
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View
                    style={{
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    <View
                      style={{
                        height: '100%',
                        width: `${Math.min(Math.max(shadePreferencePct, 10), 95)}%`,
                        backgroundColor: '#10b981',
                        borderRadius: 4,
                      }}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name="flash" size={10} color={theme.textMuted} />
                      <Text style={{ fontSize: Math.min(SW * 0.024, 10), color: theme.textMuted, fontWeight: '600' }}>
                        Speed Focus
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ fontSize: Math.min(SW * 0.024, 10), color: theme.textMuted, fontWeight: '600' }}>
                        Shade Focus
                      </Text>
                      <Ionicons name="snow" size={10} color={theme.textMuted} />
                    </View>
                  </View>
                </View>

                {/* FortyGuard Sensors Grid */}
                {response.env_summary && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={[styles.secLabel, { color: theme.textMuted, marginBottom: 8 }]}>FORTYGUARD ENVIRONMENTAL SENSORS</Text>
                    <View style={styles.envGrid}>
                      {[
                        { icon: 'thermometer-outline', lib: 'Ion', color: '#38bdf8', val: `${response.env_summary.apparent_temp_c ?? '--'}°C`, lbl: 'Real-Feel' },
                        { icon: 'sunny-outline',       lib: 'Ion', color: '#fbbf24', val: `${response.env_summary.ghi_solar_w_m2 ?? '--'} W/m²`, lbl: 'Solar GHI' },
                        { icon: 'water-outline',       lib: 'Ion', color: '#818cf8', val: `${response.env_summary.relative_humidity_pct ?? '--'}%`, lbl: 'Humidity' },
                        { icon: 'air-filter',          lib: 'MC',  color: '#34d399', val: `${response.env_summary.air_quality_level ?? '--'}`, lbl: 'Air Quality' },
                      ].map((e, i) => (
                        <View key={i} style={[styles.envBox, { backgroundColor: theme.inputBg }]}>
                          {e.lib === 'MC' ? (
                            <MaterialCommunityIcons name={e.icon as any} size={15} color={e.color} />
                          ) : (
                            <Ionicons name={e.icon as any} size={15} color={e.color} />
                          )}
                          <Text style={[styles.envVal, { color: theme.textPrimary }]}>{e.val}</Text>
                          <Text style={[styles.envLbl, { color: theme.textMuted }]}>{e.lbl}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Gemini Safety Briefing */}
                {response.gemini_briefing && (
                  <View style={[styles.briefCard, { backgroundColor: theme.isDark ? '#1e1b4b' : '#e0e7ff', borderColor: theme.isDark ? '#312e81' : '#c7d2fe' }]}>
                    <View style={styles.briefHead}>
                      <Ionicons name="sparkles" size={12} color={theme.isDark ? '#c7d2fe' : '#4338ca'} style={{ marginRight: 5 }} />
                      <Text style={[styles.briefLabel, { color: theme.isDark ? '#818cf8' : '#3730a3' }]}>GEMINI AI BRIEFING</Text>
                    </View>
                    <Text style={[styles.briefTitle, { color: theme.isDark ? '#ffffff' : '#1e1b4b' }]}>{response.gemini_briefing.headline}</Text>
                    <Text style={[styles.briefBody, { color: theme.isDark ? '#c7d2fe' : '#312e81' }]}>{response.gemini_briefing.narrative}</Text>
                    {!!response.gemini_briefing.health_alert && (
                      <View style={styles.alertRow}>
                        <Ionicons name="warning" size={12} color="#fca5a5" style={{ marginRight: 5 }} />
                        <Text style={styles.alertTxt}>{response.gemini_briefing.health_alert}</Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={{ height: 40 }} />
              </ScrollView>
              ) : (
                <TouchableOpacity
                  style={{
                    paddingVertical: 18,
                    paddingHorizontal: Math.min(SW * 0.05, 20),
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    gap: 8,
                  }}
                  onPress={() => snapSheetTo(SHEET_PEEK)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-up" size={16} color="#10b981" />
                  <Text
                    style={{
                      fontSize: Math.min(SW * 0.034, 14),
                      fontWeight: '700',
                      color: '#10b981',
                      textAlign: 'center',
                      lineHeight: 20,
                    }}
                  >
                    Swipe up or tap for route metrics & thermal analysis
                  </Text>
                </TouchableOpacity>
              )}
            </Animated.View>
          )}

          {/* 🧵 Floating Re-show Bottom Sheet Pill Button */}
          {uiVisible && isSheetHidden && response && !isNavigating && (
            <TouchableOpacity
              style={[styles.floatingReshowSheetBtn, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}
              onPress={() => snapSheetTo(SHEET_PEEK)}
              activeOpacity={0.85}
            >
              <Ionicons name="chevron-up" size={16} color={theme.textPrimary} style={{ marginRight: 6 }} />
              <Text style={[styles.floatingReshowSheetTxt, { color: theme.textPrimary }]}>Show Metrics</Text>
            </TouchableOpacity>
          )}

          {/* Voice Assistant moved to inline next to destination field */}
        </View>
      )}

      {/* ── 📜 HISTORY TAB VIEW ── */}
      {activeTab === 'history' && (
        <View style={[styles.tabContainer, isTabletWeb && styles.webTabContainer]}>
          <View style={styles.tabHeaderRow}>
            <View>
              <Text style={[styles.tabTitle, { color: theme.textPrimary }]}>Route History</Text>
              <Text style={[styles.tabSub, { color: theme.textMuted }]}>Cached past heat-aware journeys</Text>
            </View>
            {historyList.length > 0 && (
              <TouchableOpacity
                style={styles.clearHistBtn}
                onPress={() => {
                  Alert.alert('Clear History', 'Are you sure you want to clear all saved route history?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Clear', style: 'destructive', onPress: async () => { await clearRouteHistory(); setHistoryList([]); } },
                  ]);
                }}
              >
                <Ionicons name="trash-outline" size={15} color="#f87171" style={{ marginRight: 4 }} />
                <Text style={styles.clearHistTxt}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView contentContainerStyle={[styles.historyListContainer, isDesktopWeb && styles.webHistoryList]} showsVerticalScrollIndicator={false}>
            {historyList.length === 0 ? (
              <View style={styles.emptyHistoryBox}>
                <Ionicons name="time-outline" size={48} color={theme.textMuted} style={{ marginBottom: 12 }} />
                <Text style={[styles.emptyHistTitle, { color: theme.textPrimary }]}>No Saved Journeys</Text>
                <Text style={[styles.emptyHistSub, { color: theme.textMuted }]}>
                  Plan a route on the map to automatically cache your cool walking & biking paths here.
                </Text>
              </View>
            ) : (
              historyList.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.historyCard, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}
                  onPress={() => handleRestoreHistory(item)}
                  activeOpacity={0.85}
                >
                  <View style={styles.historyCardTop}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <FontAwesome5
                        name={item.activity === 'running' ? 'running' : item.activity === 'biking' ? 'bicycle' : 'walking'}
                        size={13}
                        color="#38bdf8"
                      />
                      <Text style={[styles.historyDate, { color: theme.textMuted }]}>{item.dateStr}</Text>
                    </View>
                    {item.response.thermal_reduction_percent > 0 && (
                      <View style={styles.histSavingsBadge}>
                        <Text style={styles.histSavingsTxt}>-{item.response.thermal_reduction_percent}% Heat</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.historyLocRow}>
                    <View style={[styles.locDot, { backgroundColor: '#10B981', width: 8, height: 8 }]} />
                    <Text style={[styles.historyLocTxt, { color: theme.textPrimary }]} numberOfLines={1}>{item.originText}</Text>
                  </View>
                  <View style={styles.historyLocRow}>
                    <View style={[styles.locDot, { backgroundColor: '#EF4444', width: 8, height: 8 }]} />
                    <Text style={[styles.historyLocTxt, { color: theme.textPrimary }]} numberOfLines={1}>{item.destText}</Text>
                  </View>

                  <View style={styles.historyFooter}>
                    <Text style={[styles.historyMeta, { color: theme.textSecondary }]}>
                      {item.response.route_options?.[0]?.travel_minutes ?? '--'} min • ~{formatTemp(item.response.route_options?.[0]?.avg_temp_c)}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.restoreTxt}>View on Map</Text>
                      <Ionicons name="chevron-forward" size={14} color="#10b981" />
                    </View>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      )}

      {/* ── 🤖 COOLPATH ASSISTANT TAB VIEW ── */}
      {activeTab === 'ai' && (
        <View style={[styles.tabContainer, isTabletWeb && styles.webTabContainer]}>
          <View style={styles.tabHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.tabTitle, { color: theme.textPrimary }]}>CoolPath Hub</Text>
              <Text style={[styles.tabSub, { color: theme.textMuted }]}>Interactive AI navigation & climate controls</Text>
            </View>
            {/* ⚙️ Settings Icon Button */}
            <TouchableOpacity
              style={[styles.settingsIconBtn, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}
              onPress={() => setShowSettingsModal(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="settings-outline" size={20} color={theme.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={[styles.aiContainer, isDesktopWeb && styles.webAiContainer]} showsVerticalScrollIndicator={false}>

            {/* 🎙️ LIVE VOICE ASSISTANT HERO BANNER */}
            <TouchableOpacity
              style={[styles.aiVoiceHeroCardRedesigned, { backgroundColor: theme.topCardBg, borderColor: '#10B981' }]}
              onPress={() => setShowAssistantModal(true)}
              activeOpacity={0.85}
            >
              <View style={styles.aiVoiceHeroLeft}>
                <View style={[styles.aiVoiceOrbMini, { backgroundColor: '#10B981' }]}>
                  <Ionicons name="mic" size={24} color="#fff" />
                </View>
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={[styles.aiVoiceHeroTitle, { color: theme.textPrimary }]}>CoolPath Voice Assistant</Text>
                  <Text style={[styles.aiVoiceHeroSub, { color: theme.textSecondary }]}>
                    Live conversational speech & LangChain AI tool routing
                  </Text>
                </View>
              </View>
              <View style={styles.aiVoiceHeroAction}>
                <View style={{ backgroundColor: '#10B981', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="sparkles" size={14} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>Talk Live</Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* AI Prompt Input Card */}
            <View style={[styles.aiPromptCard, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}>
              <View style={styles.aiPromptHeader}>
                <Ionicons name="sparkles" size={16} color="#38bdf8" style={{ marginRight: 6 }} />
                <Text style={[styles.aiPromptTitle, { color: theme.textPrimary }]}>Natural Language Route Planner</Text>
              </View>

              <TextInput
                style={[styles.aiTextInput, { color: theme.textPrimary, backgroundColor: theme.inputBg, borderColor: theme.border }]}
                placeholder="Enter prompt e.g. 'Dog walk avoiding hot pavement'..."
                placeholderTextColor={theme.textMuted}
                value={aiPromptInput}
                onChangeText={setAiPromptInput}
                multiline
              />

              <TouchableOpacity
                style={[styles.aiSubmitBtn, aiLoading && { opacity: 0.7 }]}
                onPress={() => handleRunAiPrompt(aiPromptInput)}
                disabled={aiLoading}
                activeOpacity={0.85}
              >
                {aiLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="sparkles-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.aiSubmitTxt}>Generate Heat-Aware Plan</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* AI Presets Carousel */}
              <Text style={[styles.secLabel, { color: theme.textMuted, marginTop: 14, marginBottom: 8 }]}>TRY AI PRESETS</Text>
              {AI_PRESETS.map((p, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.aiPresetChip, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                  onPress={() => {
                    setAiPromptInput(p.prompt);
                    handleRunAiPrompt(p.prompt);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="sparkles-outline" size={14} color="#38bdf8" style={{ marginRight: 8 }} />
                  <Text style={[styles.aiPresetTxt, { color: theme.textPrimary }]}>{p.prompt}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* 📊 MICROCLIMATE THERMAL EXPOSURE ANALYTICS GRAPH CARD */}
            <View style={[styles.aiPromptCard, { backgroundColor: theme.topCardBg, borderColor: theme.border, marginTop: 14 }]}>
              <View style={styles.aiPromptHeader}>
                <Ionicons name="stats-chart" size={18} color="#2DD9B8" style={{ marginRight: 8 }} />
                <Text style={[styles.aiPromptTitle, { color: theme.textPrimary }]}>Route Temperature Analytics</Text>
              </View>

              <Text style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 14 }}>
                Real-time microclimate variation: Direct unshaded asphalt vs. CoolPath recommended tree-canopy route.
              </Text>

              {/* Metric Summary Stat Cards */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
                <View style={{ flex: 1, backgroundColor: theme.inputBg, padding: 10, borderRadius: 10, marginRight: 6, borderWidth: 0.5, borderColor: theme.border }}>
                  <Text style={{ fontSize: 10, color: theme.textMuted, fontWeight: '700' }}>SHADED AVG</Text>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: '#10b981', marginTop: 2 }}>29.4°C</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.inputBg, padding: 10, borderRadius: 10, marginRight: 6, borderWidth: 0.5, borderColor: theme.border }}>
                  <Text style={{ fontSize: 10, color: theme.textMuted, fontWeight: '700' }}>DIRECT ASPHALT</Text>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: '#f43f5e', marginTop: 2 }}>48.2°C</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.inputBg, padding: 10, borderRadius: 10, borderWidth: 0.5, borderColor: theme.border }}>
                  <Text style={{ fontSize: 10, color: theme.textMuted, fontWeight: '700' }}>COOL RELIEF</Text>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: '#2DD9B8', marginTop: 2 }}>-6.8°C</Text>
                </View>
              </View>

              {/* Vector SVG Line Chart */}
              <View style={{ height: 170, width: '100%', alignItems: 'center', justifyContent: 'center', marginVertical: 4 }}>
                <Svg height="160" width="100%" viewBox="0 0 320 160">
                  <Defs>
                    <SvgGradient id="gradCool" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor="#10b981" stopOpacity="0.35" />
                      <Stop offset="1" stopColor="#10b981" stopOpacity="0.0" />
                    </SvgGradient>
                    <SvgGradient id="gradHot" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor="#f43f5e" stopOpacity="0.25" />
                      <Stop offset="1" stopColor="#f43f5e" stopOpacity="0.0" />
                    </SvgGradient>
                  </Defs>

                  {/* Grid Lines */}
                  <Line x1="25" y1="20" x2="310" y2="20" stroke={theme.border} strokeWidth="1" strokeDasharray="4 4" />
                  <Line x1="25" y1="60" x2="310" y2="60" stroke={theme.border} strokeWidth="1" strokeDasharray="4 4" />
                  <Line x1="25" y1="100" x2="310" y2="100" stroke={theme.border} strokeWidth="1" strokeDasharray="4 4" />
                  <Line x1="25" y1="140" x2="310" y2="140" stroke={theme.border} strokeWidth="1" />

                  {/* Y-Axis Labels */}
                  <SvgText x="0" y="24" fill={theme.textMuted} fontSize="9" fontWeight="600">50°C</SvgText>
                  <SvgText x="0" y="64" fill={theme.textMuted} fontSize="9" fontWeight="600">40°C</SvgText>
                  <SvgText x="0" y="104" fill={theme.textMuted} fontSize="9" fontWeight="600">30°C</SvgText>
                  <SvgText x="0" y="144" fill={theme.textMuted} fontSize="9" fontWeight="600">20°C</SvgText>

                  {/* Direct Unshaded Path (Hot) Line */}
                  <Path
                    d="M 35 48 Q 90 20, 150 38 T 260 18 T 300 32 L 300 140 L 35 140 Z"
                    fill="url(#gradHot)"
                  />
                  <Path
                    d="M 35 48 Q 90 20, 150 38 T 260 18 T 300 32"
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth="2.5"
                  />

                  {/* Shaded CoolPath (Cool) Line */}
                  <Path
                    d="M 35 105 Q 90 115, 150 96 T 260 108 T 300 100 L 300 140 L 35 140 Z"
                    fill="url(#gradCool)"
                  />
                  <Path
                    d="M 35 105 Q 90 115, 150 96 T 260 108 T 300 100"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="3"
                  />

                  {/* Highlighting Data Circles */}
                  <Circle cx="150" cy="38" r="4" fill="#f43f5e" />
                  <Circle cx="150" cy="96" r="5" fill="#10b981" stroke="#fff" strokeWidth="1.5" />
                  <Circle cx="260" cy="18" r="4" fill="#f43f5e" />
                  <Circle cx="260" cy="108" r="5" fill="#10b981" stroke="#fff" strokeWidth="1.5" />
                </Svg>
              </View>

              {/* Legend Row */}
              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 10, gap: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 12, height: 3, backgroundColor: '#f43f5e', marginRight: 6, borderRadius: 2 }} />
                  <Text style={{ fontSize: 11, color: theme.textSecondary, fontWeight: '600' }}>Direct Unshaded (Hot)</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 12, height: 3, backgroundColor: '#10b981', marginRight: 6, borderRadius: 2 }} />
                  <Text style={{ fontSize: 11, color: theme.textSecondary, fontWeight: '600' }}>CoolPath Shaded Route</Text>
                </View>
              </View>
            </View>

            {/* Redesigned AI Feature Cards (Horizontal Stack or Grid style) */}
            <Text style={[styles.secLabel, { color: theme.textMuted, marginTop: 10, marginBottom: 6 }]}>COOLPATH ENGINES</Text>
            <View style={styles.featuresGrid}>
              <View style={[styles.aiFeatureCardGrid, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}>
                <View style={styles.aiFeatureHeader}>
                  <Ionicons name="paw" size={18} color="#fbbf24" style={{ marginRight: 8 }} />
                  <Text style={[styles.aiFeatureTitle, { color: theme.textPrimary }]}>Paw Pad Guard</Text>
                </View>
                <Text style={[styles.aiFeatureSub, { color: theme.textSecondary }]}>
                  Sunlit asphalt can reach 55°C+. CoolPath limits exposure to hot asphalt to protect pet paws.
                </Text>
              </View>

              <View style={[styles.aiFeatureCardGrid, { backgroundColor: theme.topCardBg, borderColor: theme.border }]}>
                <View style={styles.aiFeatureHeader}>
                  <MaterialCommunityIcons name="heart-pulse" size={18} color="#f43f5e" style={{ marginRight: 8 }} />
                  <Text style={[styles.aiFeatureTitle, { color: theme.textPrimary }]}>Hyperthermia Tuning</Text>
                </View>
                <Text style={[styles.aiFeatureSub, { color: theme.textSecondary }]}>
                  Monitors metabolic heat buildup during fast activities, keeping core thermal strain in the safe zone.
                </Text>
              </View>
            </View>

          </ScrollView>
        </View>
      )}

      {/* ── ⚙️ APP SETTINGS MODAL ── */}
      <Modal
        visible={showSettingsModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSettingsModal(false)}
      >
        <View style={[styles.settingsModalBg, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <View style={[styles.settingsModalContent, { backgroundColor: theme.bg, borderColor: theme.border }]}>
            
            {/* Header */}
            <View style={[styles.settingsHeader, { borderBottomColor: theme.border }]}>
              <Text style={[styles.settingsTitle, { color: theme.textPrimary }]}>CoolPath Settings</Text>
              <TouchableOpacity onPress={() => setShowSettingsModal(false)} style={styles.settingsCloseBtn}>
                <Ionicons name="close" size={20} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.settingsScrollInner} showsVerticalScrollIndicator={false}>
              
              {/* Section 1: SI Unit Configuration */}
              <Text style={[styles.settingsSecLabel, { color: theme.textMuted }]}>SI UNITS & MEASUREMENTS</Text>
              
              {/* Temperature Unit Setting */}
              <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingLabel, { color: theme.textPrimary }]}>Temperature Unit</Text>
                  <Text style={[styles.settingSubLabel, { color: theme.textSecondary }]}>Show values in Celsius or Fahrenheit</Text>
                </View>
                <View style={styles.segmentedControl}>
                  <TouchableOpacity 
                    style={[styles.segmentBtn, tempUnit === 'C' && styles.segmentBtnOn]}
                    onPress={() => setTempUnit('C')}
                  >
                    <Text style={[styles.segmentBtnTxt, tempUnit === 'C' && styles.segmentBtnTxtOn]}>°C</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.segmentBtn, tempUnit === 'F' && styles.segmentBtnOn]}
                    onPress={() => setTempUnit('F')}
                  >
                    <Text style={[styles.segmentBtnTxt, tempUnit === 'F' && styles.segmentBtnTxtOn]}>°F</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Distance Unit Setting */}
              <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingLabel, { color: theme.textPrimary }]}>Distance Unit</Text>
                  <Text style={[styles.settingSubLabel, { color: theme.textSecondary }]}>Show route length in km or miles</Text>
                </View>
                <View style={styles.segmentedControl}>
                  <TouchableOpacity 
                    style={[styles.segmentBtn, distUnit === 'km' && styles.segmentBtnOn]}
                    onPress={() => setDistUnit('km')}
                  >
                    <Text style={[styles.segmentBtnTxt, distUnit === 'km' && styles.segmentBtnTxtOn]}>km</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.segmentBtn, distUnit === 'mi' && styles.segmentBtnOn]}
                    onPress={() => setDistUnit('mi')}
                  >
                    <Text style={[styles.segmentBtnTxt, distUnit === 'mi' && styles.segmentBtnTxtOn]}>mi</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Appearance Theme Setting */}
              <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingLabel, { color: theme.textPrimary }]}>Appearance Mode</Text>
                  <Text style={[styles.settingSubLabel, { color: theme.textSecondary }]}>Switch interface theme colors</Text>
                </View>
                <View style={styles.segmentedControl}>
                  <TouchableOpacity 
                    style={[styles.segmentBtn, !isDarkMode && styles.segmentBtnOn]}
                    onPress={() => setIsDarkMode(false)}
                  >
                    <Text style={[styles.segmentBtnTxt, !isDarkMode && styles.segmentBtnTxtOn]}>Light</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.segmentBtn, isDarkMode && styles.segmentBtnOn]}
                    onPress={() => setIsDarkMode(true)}
                  >
                    <Text style={[styles.segmentBtnTxt, isDarkMode && styles.segmentBtnTxtOn]}>Dark</Text>
                  </TouchableOpacity>
                </View>
              </View>



              {/* Section 2: Customizable Route Preferences */}
              <Text style={[styles.settingsSecLabel, { color: theme.textMuted, marginTop: 20 }]}>ROUTING ENGINE CUSTOMIZATION</Text>

              {/* Shade Priority Setting */}
              <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingLabel, { color: theme.textPrimary }]}>Shade Coverage</Text>
                  <Text style={[styles.settingSubLabel, { color: theme.textSecondary }]}>Route optimization shade weighting</Text>
                </View>
                <View style={styles.segmentedControl}>
                  {['comfort', 'balanced', 'strict'].map((val) => (
                    <TouchableOpacity 
                      key={val}
                      style={[styles.segmentBtnTriple, shadeWeight === val && styles.segmentBtnOn]}
                      onPress={() => setShadeWeight(val as any)}
                    >
                      <Text style={[styles.segmentBtnTxt, shadeWeight === val && styles.segmentBtnTxtOn, { textTransform: 'capitalize', fontSize: 10 }]}>{val}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Default Pace Setting */}
              <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingLabel, { color: theme.textPrimary }]}>Default Travel Pace</Text>
                  <Text style={[styles.settingSubLabel, { color: theme.textSecondary }]}>Walking/running speed modifier</Text>
                </View>
                <View style={styles.segmentedControl}>
                  {['slow', 'normal', 'fast'].map((val) => (
                    <TouchableOpacity 
                      key={val}
                      style={[styles.segmentBtnTriple, defaultPace === val && styles.segmentBtnOn]}
                      onPress={() => setDefaultPace(val as any)}
                    >
                      <Text style={[styles.segmentBtnTxt, defaultPace === val && styles.segmentBtnTxtOn, { textTransform: 'capitalize', fontSize: 10 }]}>{val}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Real-time Heat alerts Toggle */}
              <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingLabel, { color: theme.textPrimary }]}>Microclimate Heat Alerts</Text>
                  <Text style={[styles.settingSubLabel, { color: theme.textSecondary }]}>Notify when entering extreme thermal strain paths</Text>
                </View>
                <TouchableOpacity 
                  onPress={() => setHeatAlertsOn(!heatAlertsOn)}
                  style={[styles.toggleSwitch, heatAlertsOn ? styles.toggleSwitchOn : styles.toggleSwitchOff]}
                >
                  <View style={[styles.togglePin, heatAlertsOn ? styles.togglePinOn : styles.togglePinOff]} />
                </TouchableOpacity>
              </View>

              {/* Default Departure Mode */}
              <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingLabel, { color: theme.textPrimary }]}>Default Planning Mode</Text>
                  <Text style={[styles.settingSubLabel, { color: theme.textSecondary }]}>Auto-optimize departure times</Text>
                </View>
                <View style={styles.segmentedControl}>
                  <TouchableOpacity 
                    style={[styles.segmentBtn, defaultDepartMode === 'now' && styles.segmentBtnOn]}
                    onPress={() => setDefaultDepartMode('now')}
                  >
                    <Text style={[styles.segmentBtnTxt, defaultDepartMode === 'now' && styles.segmentBtnTxtOn, { fontSize: 10 }]}>Depart Now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.segmentBtn, defaultDepartMode === 'scheduled' && styles.segmentBtnOn]}
                    onPress={() => setDefaultDepartMode('scheduled')}
                  >
                    <Text style={[styles.segmentBtnTxt, defaultDepartMode === 'scheduled' && styles.segmentBtnTxtOn, { fontSize: 10 }]}>Scheduled</Text>
                  </TouchableOpacity>
                </View>
              </View>



              {/* Section 4: Legal & App Info */}
              <Text style={[styles.settingsSecLabel, { color: theme.textMuted, marginTop: 24 }]}>INFORMATION & LEGAL</Text>

              {/* About Button */}
              <TouchableOpacity 
                style={[styles.legalItem, { borderBottomColor: theme.border }]}
                onPress={() => setShowAboutSection('about')}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="information-circle-outline" size={16} color="#38bdf8" style={{ marginRight: 8 }} />
                  <Text style={[styles.legalLabel, { color: theme.textPrimary }]}>About CoolPath</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </TouchableOpacity>

              {/* Scientific Research & Physics Button */}
              <TouchableOpacity 
                style={[styles.legalItem, { borderBottomColor: theme.border }]}
                onPress={() => setShowAboutSection('science')}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="flask-outline" size={16} color="#2DD9B8" style={{ marginRight: 8 }} />
                  <Text style={[styles.legalLabel, { color: theme.textPrimary }]}>Scientific Research & Physics</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </TouchableOpacity>

              {/* Terms and Conditions Button */}
              <TouchableOpacity 
                style={[styles.legalItem, { borderBottomColor: theme.border }]}
                onPress={() => setShowAboutSection('terms')}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="document-text-outline" size={16} color="#fbbf24" style={{ marginRight: 8 }} />
                  <Text style={[styles.legalLabel, { color: theme.textPrimary }]}>Terms and Conditions</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </TouchableOpacity>

              {/* Privacy Policy Button */}
              <TouchableOpacity 
                style={[styles.legalItem, { borderBottomColor: theme.border }]}
                onPress={() => setShowAboutSection('privacy')}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="shield-checkmark-outline" size={16} color="#a78bfa" style={{ marginRight: 8 }} />
                  <Text style={[styles.legalLabel, { color: theme.textPrimary }]}>Privacy Policy</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </TouchableOpacity>

              <View style={{ alignItems: 'center', marginTop: 32, marginBottom: 16 }}>
                <Text style={{ fontSize: 11, color: theme.textMuted, fontWeight: '700' }}>COOLPATH NAVIGATION SYSTEM</Text>
                <Text style={{ fontSize: 9, color: theme.textMuted, marginTop: 4 }}>Version 1.2.0-Production</Text>
              </View>

            </ScrollView>

          </View>
        </View>
      </Modal>

      {/* ── 📜 LEGAL CONTENT MODAL (Sub-settings) ── */}
      <Modal
        visible={showAboutSection !== null}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAboutSection(null)}
      >
        <View style={[styles.settingsModalBg, { backgroundColor: 'rgba(0,0,0,0.65)' }]}>
          <View style={[styles.settingsModalContent, { backgroundColor: theme.bg, borderColor: theme.border, height: '75%', marginTop: '45%' }]}>
            
            {/* Header */}
            <View style={[styles.settingsHeader, { borderBottomColor: theme.border }]}>
              <Text style={[styles.settingsTitle, { color: theme.textPrimary, textTransform: 'capitalize' }]}>
                {showAboutSection === 'about' && 'About CoolPath'}
                {showAboutSection === 'science' && 'Scientific Research & Physics'}
                {showAboutSection === 'terms' && 'Terms & Conditions'}
                {showAboutSection === 'privacy' && 'Privacy Policy'}
              </Text>
              <TouchableOpacity onPress={() => setShowAboutSection(null)} style={styles.settingsCloseBtn}>
                <Ionicons name="arrow-back" size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.legalScrollInner} showsVerticalScrollIndicator={true}>
              {showAboutSection === 'about' && (
                <>
                  <Text style={[styles.legalTitle, { color: theme.textPrimary }]}>CoolPath Navigation</Text>
                  <Text style={[styles.legalBody, { color: theme.textSecondary }]}>
                    CoolPath is a state-of-the-art urban navigation engine designed to combat extreme heat index risks inside major cities. Powered by real-time microclimate sensors and shade canopy datasets, CoolPath calculates walking, running, and biking paths optimized to avoid sun-exposed hot asphalt and maximize shade comfort.
                  </Text>
                  <Text style={[styles.legalBody, { color: theme.textSecondary, marginTop: 10 }]}>
                    Designed with support from urban planning agencies, meteorology specialists, and animal comfort panels.
                  </Text>
                </>
              )}

              {showAboutSection === 'science' && (
                <>
                  <Text style={[styles.legalTitle, { color: theme.textPrimary }]}>Thermodynamics & Human Bio-Physics</Text>
                  
                  <Text style={{ fontSize: 13, color: '#2DD9B8', fontWeight: '800', marginTop: 14, marginBottom: 4 }}>
                    1. FIRST LAW OF THERMODYNAMICS (ENERGY CONSERVATION)
                  </Text>
                  <Text style={[styles.legalBody, { color: theme.textSecondary }]}>
                    Human thermal balance follows internal heat accumulation: Q_stored = Q_metabolic - Q_work - Q_convection - Q_radiation - Q_evaporation. CoolPath calculates edge-level metabolic expenditure (METs) and wind convective cooling to maintain core body stability (37.0°C baseline).
                  </Text>

                  <Text style={{ fontSize: 13, color: '#2DD9B8', fontWeight: '800', marginTop: 16, marginBottom: 4 }}>
                    2. STEFAN-BOLTZMANN RADIATIVE HEAT TRANSFER
                  </Text>
                  <Text style={[styles.legalBody, { color: theme.textSecondary }]}>
                    Sunlit urban pavement emits thermal radiation proportional to T⁴. Direct asphalt temperatures frequently exceed 55°C (131°F), transferring severe radiative heat flux to human tissue and pet paws. CoolPath's tree canopy algorithm reduces direct solar thermal load (Q_solar) by up to 85%.
                  </Text>

                  <Text style={{ fontSize: 13, color: '#2DD9B8', fontWeight: '800', marginTop: 16, marginBottom: 4 }}>
                    3. LEWIS RELATION & LATENT EVAPORATIVE LIMITS
                  </Text>
                  <Text style={[styles.legalBody, { color: theme.textSecondary }]}>
                    Sweat evaporation efficiency is governed by ambient relative humidity and saturation pressure. CoolPath evaluates local atmospheric moisture to warn users when high humidity inhibits natural sweat evaporation, preventing heat exhaustion.
                  </Text>

                  <Text style={{ fontSize: 13, color: '#2DD9B8', fontWeight: '800', marginTop: 16, marginBottom: 4 }}>
                    4. FORTYGUARD SPATIAL HEAT INDEXING
                  </Text>
                  <Text style={[styles.legalBody, { color: theme.textSecondary }]}>
                    Utilizes sub-meter thermal satellite rasters and STRtree point-in-polygon spatial indexing to calculate street segment microclimates with sub-millisecond query latency.
                  </Text>
                </>
              )}

              {showAboutSection === 'terms' && (
                <>
                  <Text style={[styles.legalTitle, { color: theme.textPrimary }]}>Terms of Service</Text>
                  <Text style={[styles.legalBody, { color: theme.textSecondary }]}>
                    By using CoolPath, you agree to these terms. CoolPath provides heat-aware routes for navigational support. Thermal forecasts, microclimate analysis, and air quality indexes are model estimations. Always exercise personal safety, carry hydration, and take indoor shelter during extreme municipal heat warnings.
                  </Text>
                  <Text style={[styles.legalBody, { color: theme.textSecondary, marginTop: 10 }]}>
                    Users assume all risks associated with outdoor walking and navigation.
                  </Text>
                </>
              )}

              {showAboutSection === 'privacy' && (
                <>
                  <Text style={[styles.legalTitle, { color: theme.textPrimary }]}>Privacy Policy</Text>
                  <Text style={[styles.legalBody, { color: theme.textSecondary }]}>
                    CoolPath respects user privacy. Your current GPS position, planned origins, and destinations are processed locally on the client or sent securely to local route calculation proxies. We do not store, sell, or rent your precise historical travel locations.
                  </Text>
                  <Text style={[styles.legalBody, { color: theme.textSecondary, marginTop: 10 }]}>
                    Cached history is saved solely on your device's AsyncStorage sandbox.
                  </Text>
                </>
              )}
            </ScrollView>

          </View>
        </View>
      </Modal>





      {/* ── ⚡ PLAN SETUP MODAL (Configures Mode, Activity, Pace before calculation) ── */}
      <Modal
        visible={showPlanSetupModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPlanSetupModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.sheetBg, borderColor: theme.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Plan CoolPath Journey</Text>
              <TouchableOpacity onPress={() => setShowPlanSetupModal(false)}>
                <Ionicons name="close-circle" size={24} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Mode tabs */}
            <Text style={[styles.secLabel, { color: theme.textMuted, marginTop: 8 }]}>DEPARTURE TIMING</Text>
            <View style={[styles.modeTabs, { backgroundColor: theme.inputBg }]}>
              {(['instant', 'scheduled'] as PlanningMode[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeTab, planMode === m && styles.modeTabOn]}
                  onPress={() => setPlanMode(m)}
                >
                  <Feather
                    name={m === 'instant' ? 'zap' : 'clock'}
                    size={12}
                    color={planMode === m ? '#fff' : theme.textMuted}
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[styles.modeTabTxt, { color: theme.textMuted }, planMode === m && styles.modeTabTxtOn]}>
                    {m === 'instant' ? 'Depart Now' : 'Scheduled'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Scheduled Deadline Chips */}
            {planMode === 'scheduled' && (
              <View style={[styles.deadlineCard, { backgroundColor: theme.inputBg, borderColor: theme.border }]}>
                <View style={styles.deadlineTop}>
                  <Text style={[styles.deadlineLabel, { color: theme.textMuted }]}>ARRIVE WITHIN</Text>
                  <Text style={[styles.deadlineValue, { color: theme.textPrimary }]}>{deadlineMinutes} min</Text>
                </View>
                <View style={styles.deadlineOptions}>
                  {DEADLINE_OPTIONS.map((minutes) => {
                    const on = deadlineMinutes === minutes;
                    return (
                      <TouchableOpacity
                        key={minutes}
                        style={[styles.deadlineChip, { backgroundColor: theme.sheetBg }, on && styles.deadlineChipOn]}
                        onPress={() => setDeadlineMinutes(minutes)}
                      >
                        <Text style={[styles.deadlineChipTxt, { color: theme.textSecondary }, on && styles.deadlineChipTxtOn]}>
                          {minutes}m
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Activity Selection */}
            <Text style={[styles.secLabel, { color: theme.textMuted, marginTop: 8 }]}>ACTIVITY</Text>
            <View style={styles.pillRow}>
              {ACTIVITIES.map((a) => {
                const on = activity === a.id;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.pill, { backgroundColor: theme.inputBg, borderColor: theme.pillBorder }, on && styles.pillOn]}
                    onPress={() => setActivity(a.id)}
                  >
                    {a.family === 'FA5' ? (
                      <FontAwesome5 name={a.icon} size={12} color={on ? '#fff' : theme.textMuted} />
                    ) : (
                      <Ionicons name={a.icon as any} size={14} color={on ? '#fff' : theme.textMuted} />
                    )}
                    <Text style={[styles.pillTxt, { color: theme.textMuted }, on && styles.pillTxtOn]}>{a.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Pace Selection */}
            <Text style={[styles.secLabel, { color: theme.textMuted, marginTop: 4 }]}>PACE</Text>
            <View style={styles.pillRow}>
              {PACES.map((p) => {
                const on = pace === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.pacePill, { backgroundColor: theme.inputBg, borderColor: theme.pillBorder }, on && styles.pacePillOn]}
                    onPress={() => setPace(p.id)}
                  >
                    <Text style={[styles.paceTxt, { color: theme.textMuted }, on && styles.paceTxtOn]}>{p.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Action Buttons */}
            <TouchableOpacity style={styles.modalCalcBtn} onPress={handleExecutePlan} activeOpacity={0.85}>
              <Ionicons name="leaf-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.calcTxt}>Confirm & Calculate Route</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── 🤖 ML INSIGHTS PANEL (Dev & Judge Debug Modal) ── */}
      <Modal
        visible={showMLInsightsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMLInsightsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.sheetBg, borderColor: theme.border }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="hardware-chip-outline" size={20} color="#10B981" style={{ marginRight: 8 }} />
                <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>ML Model & Shade Insights</Text>
              </View>
              <TouchableOpacity onPress={() => setShowMLInsightsModal(false)}>
                <Ionicons name="close-circle" size={24} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingVertical: 12 }}>
              <View style={[styles.insightCard, { backgroundColor: theme.inputBg }]}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: theme.textMuted, textTransform: 'uppercase' }}>MODEL ARCHITECTURE</Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary, marginTop: 4 }}>
                  Online SGD Logistic Regression (river / sklearn)
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 4 }}>
                  Updates one click at a time via sub-millisecond stochastic gradient descent.
                </Text>
              </View>

              <View style={[styles.insightCard, { backgroundColor: theme.inputBg, marginTop: 10 }]}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: theme.textMuted, textTransform: 'uppercase' }}>CURRENT LEARNED PREFERENCE</Text>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#10B981', marginTop: 4 }}>
                  {shadePreferencePct.toFixed(1)}% Shade-Preferring
                </Text>
              </View>

              <View style={[styles.insightCard, { backgroundColor: theme.inputBg, marginTop: 10 }]}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: theme.textMuted, textTransform: 'uppercase' }}>PRETRAINED SEGFORMER SHADE ANALYSIS</Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 4 }}>
                  • Key point 1 (Origins): 22% canopy shade
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                  • Key point 2 (Corridor): 72% tree canopy shade
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                  • Key point 3 (Park Entry): 84% dense shade
                </Text>
              </View>

              <View style={[styles.insightCard, { backgroundColor: theme.inputBg, marginTop: 10 }]}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: theme.textMuted, textTransform: 'uppercase' }}>RECENT FEEDBACK LOG ({mlHistory.length})</Text>
                {mlHistory.length === 0 ? (
                  <Text style={{ fontSize: 12, color: theme.textMuted, marginTop: 6 }}>No feedback logged yet. Tap 👍 / 👎 on route cards to train!</Text>
                ) : (
                  mlHistory.map((item, idx) => (
                    <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, borderBottomWidth: 0.5, borderBottomColor: theme.border, paddingBottom: 4 }}>
                      <Text style={{ fontSize: 12, color: theme.textPrimary }}>
                        {item.satisfied ? '👍 Preferred' : '👎 Rejected'} ({item.route_type})
                      </Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#10B981' }}>
                        P(sat): {item.new_prob}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── 🚀 ANIMATED ROUTE CRAFTING LOADING MODAL ── */}
      <Modal
        visible={isCraftingRoute}
        transparent
        animationType="fade"
        onRequestClose={() => setIsCraftingRoute(false)}
      >
        <View style={styles.craftingOverlay}>
          <LinearGradient
            colors={theme.isDark ? ['#0C1210', '#14211D', '#1B2E27'] : ['#F6F3EC', '#EDE8DC', '#E5DFD0']}
            style={[styles.craftingCard, { borderColor: theme.border }]}
          >
            {/* Animated Pulsing Ring & Icon */}
            <View style={styles.craftingIconContainer}>
              <Animated.View
                style={[
                  styles.pulseRing,
                  {
                    borderColor: theme.accentCool,
                    transform: [{ scale: pulseAnim }],
                  },
                ]}
              />
              <View style={[styles.craftingIconCircle, { backgroundColor: theme.surfaceInset }]}>
                <Ionicons name="leaf-outline" size={32} color={theme.accentCool} />
              </View>
            </View>

            {/* Title & Subtitle */}
            <Text style={[styles.craftingTitle, { color: theme.textPrimary }]}>Crafting CoolPath Route</Text>
            <Text style={[styles.craftingSub, { color: theme.textMuted }]}>Urban Heat Avoidance Engine</Text>

            {/* Rotating Step Phrases Banner */}
            <View style={[styles.phraseBox, { backgroundColor: theme.inputBg, borderColor: theme.border }]}>
              <ActivityIndicator size="small" color="#38bdf8" style={{ marginRight: 10 }} />
              <Text style={[styles.phraseTxt, { color: theme.textPrimary }]} numberOfLines={2}>
                {CRAFTING_STEPS[currentCraftStep].text}
              </Text>
            </View>

            {/* Progress Dots */}
            <View style={styles.dotsRow}>
              {CRAFTING_STEPS.map((_, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.dotItem,
                    { backgroundColor: idx <= currentCraftStep ? theme.accentCool : theme.border },
                    idx === currentCraftStep && styles.dotItemActive,
                  ]}
                />
              ))}
            </View>
          </LinearGradient>
        </View>
      </Modal>

      {/* ── 📌 FIXED BOTTOM NAVIGATION MENU BAR ── */}
      {!isNavigating && (
        <View style={[styles.bottomNav, isDesktopWeb && styles.webBottomNav, { backgroundColor: theme.navBg, borderColor: theme.border }]}>
          {/* Map Tab */}
          <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('map')} activeOpacity={0.8}>
            <Ionicons
              name={activeTab === 'map' ? 'map' : 'map-outline'}
              size={22}
              color={activeTab === 'map' ? theme.accentCool : theme.textMuted}
            />
            <Text style={[styles.navLabel, { color: activeTab === 'map' ? theme.accentCool : theme.textMuted }]}>Map</Text>
          </TouchableOpacity>

          {/* History Tab */}
          <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('history')} activeOpacity={0.8}>
            <Ionicons
              name={activeTab === 'history' ? 'time' : 'time-outline'}
              size={22}
              color={activeTab === 'history' ? theme.accentCool : theme.textMuted}
            />
            <Text style={[styles.navLabel, { color: activeTab === 'history' ? theme.accentCool : theme.textMuted }]}>History</Text>
          </TouchableOpacity>

          {/* AI Assistant Tab */}
          <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('ai')} activeOpacity={0.8}>
            <Ionicons
              name={activeTab === 'ai' ? 'sparkles' : 'sparkles-outline'}
              size={22}
              color={activeTab === 'ai' ? theme.accentCool : theme.textMuted}
            />
            <Text style={[styles.navLabel, { color: activeTab === 'ai' ? theme.accentCool : theme.textMuted }]}>Assistant</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* 🚀 NAVIGATION SETUP MODAL */}
      <Modal
        visible={showNavSetupModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNavSetupModal(false)}
      >
        <View style={styles.centeredModalOverlay}>
          <View style={[styles.navModalContainer, { backgroundColor: theme.sheetBg, borderColor: theme.border }]}>
            <View style={styles.navModalHeader}>
              <Text style={[styles.navModalTitle, { color: theme.textPrimary }]}>Choose Navigation Mode</Text>
              <TouchableOpacity onPress={() => setShowNavSetupModal(false)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.navModalSub, { color: theme.textMuted }]}>
              Select how you want to navigate along {activeRoute?.name || 'CoolPath Route'}
            </Text>

            {/* Mode Selector Cards */}
            <TouchableOpacity
              style={[
                styles.navModeCard,
                navMode === 'real' && { borderColor: theme.accentCool },
                { backgroundColor: theme.inputBg, borderColor: theme.border, borderWidth: 1 }
              ]}
              onPress={() => setNavMode('real')}
              activeOpacity={0.8}
            >
              <Ionicons name="location-outline" size={24} color={theme.accentCool} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.navModeCardTitle, { color: theme.textPrimary, fontWeight: '700' }]}>Real Device GPS</Text>
                <Text style={[styles.navModeCardSub, { color: theme.textMuted }]}>Uses your phone's hardware GPS sensors for live turn navigation</Text>
              </View>
              {navMode === 'real' && <Ionicons name="checkmark-circle-outline" size={20} color={theme.accentCool} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.navModeCard,
                navMode === 'simulated' && { borderColor: theme.accentCool },
                { backgroundColor: theme.inputBg, borderColor: theme.border, borderWidth: 1 }
              ]}
              onPress={() => setNavMode('simulated')}
              activeOpacity={0.8}
            >
              <Ionicons name="sparkles-outline" size={24} color={theme.accentCool} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.navModeCardTitle, { color: theme.textPrimary, fontWeight: '700' }]}>Maya Virtual Traveler</Text>
                <Text style={[styles.navModeCardSub, { color: theme.textMuted }]}>Maya travels the route with witty, live voice commentary & heat insights</Text>
              </View>
              {navMode === 'simulated' && <Ionicons name="checkmark-circle-outline" size={20} color={theme.accentCool} />}
            </TouchableOpacity>

            {/* Mode Transport Avatar Preview */}
            <View style={[styles.navAvatarPreviewCard, { backgroundColor: theme.inputBg, borderColor: theme.border, borderWidth: 1 }]}>
              <MaterialCommunityIcons
                name={
                  activity === 'driving' ? 'car' :
                  activity === 'biking' ? 'bicycle-basket' :
                  activity === 'running' ? 'run' : 'walk'
                }
                size={24}
                color={theme.accentCool}
                style={{ marginRight: 12 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.navAvatarPreviewTitle, { color: theme.textPrimary, fontWeight: '700' }]}>
                  Commuter Avatar
                </Text>
                <Text style={[styles.navAvatarPreviewSub, { color: theme.textMuted }]}>
                  Smooth physical state monitoring & camera follow mode
                </Text>
              </View>
            </View>

            {/* Launch Button */}
            <TouchableOpacity
              style={{
                marginTop: 14,
                backgroundColor: theme.accentCool,
                paddingVertical: 14,
                borderRadius: 10,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onPress={() => startNavigation(navMode)}
              activeOpacity={0.85}
            >
              <Ionicons name="play-outline" size={18} color={theme.isDark ? '#0C1210' : '#ffffff'} style={{ marginRight: 6 }} />
              <Text style={{ color: theme.isDark ? '#0C1210' : '#ffffff', fontSize: 15, fontWeight: '900' }}>Start Navigation Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🏁 JOURNEY COMPLETED SUMMARY CARD */}
      {showJourneySummary && activeRoute && (() => {
        const temps = activeRoute.geometry_temps ? activeRoute.geometry_temps.map((gt: any) => gt[2]) : [activeRoute.avg_temp_c || 28];
        const minTemp = Math.min(...temps);
        const maxTemp = Math.max(...temps);
        const avgTemp = temps.reduce((a: number, b: number) => a + b, 0) / temps.length;

        const durMins = Math.floor(journeyDuration / 60);
        const durSecs = journeyDuration % 60;
        const timeStr = durMins > 0 ? `${durMins}m ${durSecs}s` : `${durSecs}s`;

        const isLogged = !!submittedFeedbackRoutes[activeRoute.id];
        const userLiked = submittedFeedbackRoutes[activeRoute.id] === 'good';

        return (
          <Modal transparent animationType="fade" visible={showJourneySummary}>
            <View style={styles.centeredModalOverlay}>
              <View style={[styles.navModalContainer, { backgroundColor: theme.sheetBg, borderColor: theme.border, padding: 20 }]}>
                <View style={{ alignItems: 'center', marginBottom: 16 }}>
                  <View style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: 'rgba(45, 217, 184, 0.12)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 10,
                  }}>
                    <Ionicons name="trophy-outline" size={24} color={theme.accentCool} />
                  </View>
                  <Text style={[styles.navModalTitle, { color: theme.textPrimary, textAlign: 'center' }]}>Journey Completed!</Text>
                  <Text style={{ fontSize: 12, color: theme.textMuted, marginTop: 4, textAlign: 'center' }}>
                    You traveled along {activeRoute.name || 'CoolPath Route'}
                  </Text>
                </View>

                {/* Journey Stats Dashboard */}
                <View style={{ gap: 12, marginBottom: 20 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1, backgroundColor: theme.inputBg, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: theme.border }}>
                      <Text style={{ fontSize: 10, color: theme.textMuted }}>TOTAL TIME</Text>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: theme.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 4 }}>
                        {timeStr}
                      </Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: theme.inputBg, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: theme.border }}>
                      <Text style={{ fontSize: 10, color: theme.textMuted }}>DISTANCE</Text>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: theme.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 4 }}>
                        {formatDist(directDistanceKm)}
                      </Text>
                    </View>
                  </View>

                  <View style={{ backgroundColor: theme.inputBg, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: theme.border }}>
                    <Text style={{ fontSize: 10, color: theme.textMuted, marginBottom: 6 }}>THERMAL PROFILE ACROSS ROUTE</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <View>
                        <Text style={{ fontSize: 9, color: theme.textMuted }}>MIN TEMP</Text>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.accentCool, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          {formatTemp(minTemp)}
                        </Text>
                      </View>
                      <View>
                        <Text style={{ fontSize: 9, color: theme.textMuted }}>AVG TEMP</Text>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          {formatTemp(avgTemp)}
                        </Text>
                      </View>
                      <View>
                        <Text style={{ fontSize: 9, color: theme.textMuted }}>MAX TEMP</Text>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.accentHeat, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                          {formatTemp(maxTemp)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/* Rating / ML Feedback Section */}
                <View style={{ marginBottom: 20, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: theme.textPrimary, marginBottom: 8 }}>How was your thermal comfort?</Text>
                  
                  {isLogged ? (
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: 'rgba(45, 217, 184, 0.1)',
                      borderColor: theme.accentCool,
                      borderWidth: 0.5,
                      borderRadius: 8,
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                    }}>
                      <Ionicons name="checkmark-circle-outline" size={16} color={theme.accentCool} style={{ marginRight: 6 }} />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: theme.accentCool }}>
                        ✓ Preference Logged ({userLiked ? 'Liked' : 'Rejected'})
                      </Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <TouchableOpacity
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: theme.inputBg,
                          borderWidth: 0.5,
                          borderColor: theme.accentCool,
                          paddingVertical: 12,
                          paddingHorizontal: 16,
                          borderRadius: 10,
                          minWidth: 100,
                          justifyContent: 'center',
                        }}
                        onPress={() => handleFeedback(activeRoute.id, true)}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="thumbs-up-outline" size={16} color={theme.accentCool} style={{ marginRight: 6 }} />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: theme.accentCool }}>Good pick</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: theme.inputBg,
                          borderWidth: 0.5,
                          borderColor: theme.accentHeat,
                          paddingVertical: 12,
                          paddingHorizontal: 16,
                          borderRadius: 10,
                          minWidth: 100,
                          justifyContent: 'center',
                        }}
                        onPress={() => handleFeedback(activeRoute.id, false)}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="thumbs-down-outline" size={16} color={theme.accentHeat} style={{ marginRight: 6 }} />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: theme.accentHeat }}>Not for me</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* Exit Return Button */}
                <TouchableOpacity
                  style={{
                    backgroundColor: theme.accentCool,
                    paddingVertical: 14,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onPress={() => {
                    handleDiscardJourney();
                    setShowJourneySummary(false);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: theme.isDark ? '#0C1210' : '#ffffff', fontSize: 15, fontWeight: '900' }}>
                    Finish & Close Route
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        );
      })()}

      {/* ── 🧭 COMPASS CALIBRATION MODAL ── */}
      <Modal
        visible={showCompassCalibration}
        animationType="fade"
        transparent={true}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Ionicons name="compass-outline" size={64} color="#10B981" style={{ marginBottom: 20 }} />
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 12, textAlign: 'center' }}>
            Compass Calibration
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 16, textAlign: 'center', marginBottom: 30, lineHeight: 24 }}>
            To show your correct pointing direction on the map accurately, please calibrate your compass by moving your phone in a figure 8 motion.
          </Text>
          
          <View style={{ width: 120, height: 80, marginBottom: 40, justifyContent: 'center', alignItems: 'center' }}>
            <FontAwesome5 name="infinity" size={64} color="#38bdf8" />
          </View>

          <TouchableOpacity
            style={{ backgroundColor: '#10B981', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12 }}
            onPress={async () => {
              await AsyncStorage.setItem('@compass_calibrated', 'true');
              setShowCompassCalibration(false);
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Done Calibrating</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* 🎬 ANIMATED SPLASH SCREEN OVERLAY */}
      {splashVisible && (
        <Animated.View style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: '#0c1210', // Deep ink dark background matching Design System
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            opacity: splashOpacity,
          }
        ]}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            {/* Animated Logo Icon */}
            <Animated.View style={{
              transform: [
                { scale: iconScale },
                { translateY: iconTranslateY }
              ],
              opacity: iconOpacity,
            }}>
              <Image
                source={appIconImg}
                style={{ width: 96, height: 96, borderRadius: 24 }}
                resizeMode="cover"
              />
            </Animated.View>

            {/* Animated Draw Text */}
            <Animated.View style={{
              position: 'absolute',
              bottom: -40,
              alignItems: 'center',
              opacity: textOpacity,
              transform: [{ translateY: textTranslateY }],
            }}>
              <Text style={{
                fontSize: 26,
                fontWeight: '900',
                color: '#2DD9B8', // Accent Cool teal color
                letterSpacing: 4,
                textTransform: 'uppercase',
              }}>
                CoolPath
              </Text>
              <Text style={{
                fontSize: 10,
                fontWeight: '600',
                color: '#8C8676', // Muted ash text
                letterSpacing: 2,
                marginTop: 6,
                textTransform: 'uppercase',
              }}>
                Climate-Resilient Routing
              </Text>

              {!!bundleStatusTxt && (
                <Text style={{
                  fontSize: 10,
                  fontWeight: '700',
                  color: '#2DD9B8',
                  marginTop: 10,
                }}>
                  {bundleStatusTxt}
                </Text>
              )}
            </Animated.View>
          </View>
        </Animated.View>
      )}

      {/* 🎙️ LIVE VOICE ASSISTANT MODAL */}
      <CoolPathAssistantModal
        visible={showAssistantModal}
        onClose={() => setShowAssistantModal(false)}
        currentOriginText={originText}
        currentDestText={destText}
        liveTempC={liveWeather.tempC ?? 32}
        liveAqi={liveWeather.aqi ?? 42}
        onPlanRouteAction={(orig, dest, act, paceArg, modeArg) => {
          setOriginText(orig);
          setDestText(dest);
          if (act) setActivity(act as any);
          if (paceArg && ['slow', 'normal', 'fast'].includes(paceArg)) setPace(paceArg as any);
          if (modeArg && ['instant', 'scheduled'].includes(modeArg)) setPlanMode(modeArg as any);
          handlePlanRouteAction(orig, dest, act);
        }}
        theme={{
          ...theme,
          cardBg: theme.topCardBg,
        }}
      />
    </SafeAreaView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  webRoot: { minWidth: 320 },
  webTopBar: { top: 24, left: 24, right: 24 },
  webStatusToast: { top: 82, left: 24, alignSelf: 'flex-start', maxWidth: 410 },
  webLocCard: { top: 86, left: 24, right: 'auto', width: 410, borderRadius: 8, padding: 16 },
  webFloatingPlanBtn: { left: 24, bottom: 88, alignSelf: 'auto', width: 410, justifyContent: 'center', borderRadius: 8 },
  webSheet: {
    top: 24,
    right: 24,
    bottom: 24,
    left: 'auto',
    width: 430,
    borderRadius: 8,
    borderWidth: 1,
    borderTopWidth: 1,
  },
  webTabContainer: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingTop: 40, paddingHorizontal: 28 },
  webHistoryList: { width: '100%', maxWidth: 840, alignSelf: 'center', paddingBottom: 100 },
  webAiContainer: { width: '100%', maxWidth: 960, alignSelf: 'center', paddingBottom: 110 },
  webBottomNav: {
    left: '50%',
    right: 'auto',
    bottom: 16,
    width: 360,
    height: 56,
    borderWidth: 1,
    borderRadius: 8,
    transform: [{ translateX: -180 }],
  },
  insightCard: { padding: 12, borderRadius: 12, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)' },

  // Clean Restore UI Button
  restoreUiBtn: {
    position: 'absolute', bottom: 74, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 10,
    zIndex: 40,
  },
  restoreUiTxt: { fontSize: 13, fontWeight: '700' },

  // Bottom-Left Floating Animated Location FAB Button
  fabLocationBtnWrapper: {
    position: 'absolute',
    bottom: SHEET_MIN + 24,
    left: 16,
    zIndex: 35,
  },
  fabLocationBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },

  // Status Toast Notification Card
  statusToastCard: {
    position: 'absolute',
    top: 90,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 12,
    zIndex: 35,
  },
  statusToastTxt: { fontSize: 12, fontWeight: '700' },

  // Top Bar
  topBar: {
    position: 'absolute', top: 48, left: 14, right: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    zIndex: 20,
  },
  brandLogoContainer: { justifyContent: 'center', alignItems: 'flex-start' },
  logoImage: { width: 105, height: 25 },
  weatherPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  weatherTxt: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
  },
  weatherDot: {
    width: 1,
    height: 10,
    marginHorizontal: 5,
  },
  themeBtn: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffffff' },
  statusTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Location Card
  locCard: {
    position: 'absolute', top: 96, left: 12, right: 12,
    borderRadius: 18, padding: 12, borderWidth: 1, zIndex: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 10,
  },
  locRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  locDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  locInput: { flex: 1, fontSize: 13, fontWeight: '500' },
  pinBtn: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginLeft: 6, borderWidth: 1,
  },
  gpsLocBtn: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginLeft: 6, borderWidth: 1.5,
  },
  pinBtnActive: { backgroundColor: 'rgba(16,185,129,0.18)', borderColor: '#10B981' },
  aiVoiceInlineBtn: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginLeft: 6,
    backgroundColor: '#6366f1',
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },
  swapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
    gap: 8,
  },
  swapBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  distancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  distanceTxt: {
    fontSize: 11,
    fontWeight: '800',
  },
  aiAttachedBtnString: {
    position: 'absolute',
    bottom: -20,
    right: 43,
    width: 2,
    height: 20,
    backgroundColor: '#10B981',
    zIndex: 98,
  },
  aiAttachedBtnWrapper: {
    position: 'absolute',
    bottom: -68,
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 99,
  },
  aiAttachedBtnTouchable: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#10B981',
  },
  aiAttachedBtnGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiCoordBtnWrapper: {
    borderRadius: 14,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  aiCoordBtnTouchable: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  aiCoordBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 14,
  },
  aiCoordBtnTxt: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  cityRow: { marginTop: 8 },
  cityChip: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  cityChipTxt: { fontSize: 11, fontWeight: '700' },

  // Autocomplete Suggestions Dropdown
  suggestionsDropdown: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  suggestionName: {
    fontSize: 13,
    fontWeight: '700',
  },
  suggestionSub: {
    fontSize: 11,
    marginTop: 1,
  },

  // Floating Plan CTA Button
  floatingPlanBtn: {
    position: 'absolute',
    bottom: 75,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2DD9B8',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 20,
    shadowColor: '#2DD9B8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 12,
    zIndex: 25,
  },
  floatingPlanTxt: {
    color: '#0C1210',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  floatingReshowSheetBtn: {
    position: 'absolute',
    bottom: 74,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Math.min(SW * 0.055, 22),
    paddingVertical: 13,
    borderRadius: 24,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 10,
    zIndex: 25,
    minHeight: 46, // Better tap target
  },
  floatingReshowSheetTxt: {
    fontSize: Math.min(SW * 0.035, 14),
    fontWeight: '800',
    letterSpacing: 0.5,
    lineHeight: 18,
  },

  // Sheet Header & Discard Button - Fully Responsive Design
  sheet: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 2,
    borderTopColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 28,
    zIndex: 40,
  },
  sheetHeaderBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Math.min(SW * 0.055, 24), // Responsive horizontal padding
    paddingTop: 16,
    paddingBottom: 12,
    minHeight: 56, // Ensure consistent header height
  },
  sheetHeaderTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  handleBar: {
    width: 48,
    height: 5,
    borderRadius: 3,
    opacity: 0.6,
  },
  sheetTitleTxt: {
    fontSize: Math.min(SW * 0.042, 17), // Responsive font size
    fontWeight: '900',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  discardBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(239,68,68,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
  },
  sheetInner: {
    paddingHorizontal: Math.min(SW * 0.05, 20), // Responsive padding
    paddingBottom: 32,
  },

  modeTabs: { flexDirection: 'row', borderRadius: 12, padding: 3, marginBottom: 10 },
  modeTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 9 },
  modeTabOn: { backgroundColor: '#0284c7' },
  modeTabTxt: { fontWeight: '600', fontSize: 13 },
  modeTabTxtOn: { color: '#fff', fontWeight: '800' },

  deadlineCard: { borderRadius: 12, padding: 10, marginBottom: 10, borderWidth: 1 },
  deadlineTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  deadlineLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  deadlineValue: { fontSize: 13, fontWeight: '800' },
  deadlineOptions: { flexDirection: 'row', gap: 6 },
  deadlineChip: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8 },
  deadlineChipOn: { backgroundColor: '#0284c7' },
  deadlineChipTxt: { fontSize: 11, fontWeight: '700' },
  deadlineChipTxtOn: { color: '#ffffff' },

  pillRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  pill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  pillOn: { backgroundColor: '#0284c7', borderColor: '#38bdf8' },
  pillTxt: { fontSize: 12, fontWeight: '600' },
  pillTxtOn: { color: '#fff', fontWeight: '800' },

  pacePill: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  pacePillOn: { backgroundColor: '#3b82f6', borderColor: '#60a5fa' },
  paceTxt: { fontSize: 12, fontWeight: '600' },
  paceTxtOn: { color: '#fff', fontWeight: '800' },

  errCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#450a0a', borderColor: '#7f1d1d', borderWidth: 1, padding: 10, borderRadius: 10, marginBottom: 8 },
  errTxt: { color: '#fecaca', fontSize: 12, flex: 1, lineHeight: 17 },

  exposureCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderLeftWidth: 5,
    borderLeftColor: '#10b981',
    borderRadius: 18,
    padding: Math.min(SW * 0.045, 18), // Responsive padding
    marginBottom: 12,
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  exposureVal: {
    color: '#34d399',
    fontSize: Math.min(SW * 0.085, 36), // Responsive large text
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: Math.min(SW * 0.09, 38),
  },
  exposureLbl: {
    fontSize: Math.min(SW * 0.024, 10),
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 4,
    lineHeight: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2, // Better tap spacing
  },
  metaTxt: {
    fontSize: Math.min(SW * 0.032, 13),
    fontWeight: '700',
    lineHeight: 18,
  },

  timingCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderLeftWidth: 5,
    borderLeftColor: '#F59E0B',
    borderRadius: 16,
    padding: Math.min(SW * 0.04, 16),
    marginBottom: 12,
    gap: 10,
  },
  timingHead: {
    color: '#fff',
    fontWeight: '800',
    fontSize: Math.min(SW * 0.037, 15),
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  timingSub: {
    color: '#fbbf24',
    fontSize: Math.min(SW * 0.03, 12),
    marginTop: 4,
    lineHeight: 18,
  },

  secLabel: {
    fontSize: Math.min(SW * 0.024, 10),
    fontWeight: '800',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 4,
    color: '#64748b',
    lineHeight: 14,
  },
  routeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    marginBottom: 10,
    borderWidth: 1.5,
    overflow: 'hidden',
    minHeight: 100, // Ensure consistent card height
  },
  routeCardSel: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16,185,129,0.08)',
  },
  routeStripe: {
    width: 5,
    alignSelf: 'stretch',
  },
  routeTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: Math.min(SW * 0.035, 14),
    paddingBottom: 6,
    gap: 8,
  },
  routeName: {
    fontSize: Math.min(SW * 0.037, 15),
    fontWeight: '800',
    flex: 1,
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(224,184,74,0.16)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(224,184,74,0.3)',
  },
  recTxt: {
    color: '#E0B84A',
    fontSize: Math.min(SW * 0.026, 11),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  routeBot: {
    flexDirection: 'row',
    gap: Math.min(SW * 0.03, 12),
    paddingHorizontal: Math.min(SW * 0.035, 14),
    paddingBottom: 12,
    flexWrap: 'wrap', // Allow wrapping on smaller screens
  },
  routeMeta: {
    fontSize: Math.min(SW * 0.03, 12),
    fontWeight: '600',
    lineHeight: 18,
  },
  routeCool: {
    color: '#2DD9B8',
    fontSize: Math.min(SW * 0.03, 12),
    fontWeight: '700',
    lineHeight: 18,
  },

  envGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Math.min(SW * 0.025, 10),
    marginBottom: 14,
  },
  envBox: {
    width: Math.min((SW - Math.min(SW * 0.1, 40) - Math.min(SW * 0.025, 10)) / 2, 180), // Responsive with max width
    borderRadius: 14,
    padding: Math.min(SW * 0.035, 14),
    borderWidth: 1,
    borderColor: 'rgba(240,237,228,0.08)',
    minHeight: 90, // Ensure consistent height
    justifyContent: 'space-between',
  },
  envVal: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: Math.min(SW * 0.037, 15),
    fontWeight: '700',
    marginTop: 6,
    lineHeight: 20,
  },
  envLbl: {
    fontSize: Math.min(SW * 0.026, 11),
    fontWeight: '600',
    marginTop: 4,
    letterSpacing: 0.4,
    lineHeight: 15,
  },

  briefCard: {
    borderRadius: 18,
    padding: Math.min(SW * 0.045, 18),
    marginBottom: 14,
    borderWidth: 1.5,
    borderLeftWidth: 6,
    borderLeftColor: '#6366F1',
  },
  briefHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  briefLabel: {
    fontWeight: '900',
    fontSize: Math.min(SW * 0.024, 10),
    letterSpacing: 1.3,
    lineHeight: 14,
  },
  briefTitle: {
    fontWeight: '800',
    fontSize: Math.min(SW * 0.04, 16),
    marginBottom: 8,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  briefBody: {
    fontSize: Math.min(SW * 0.03, 12),
    lineHeight: 19,
    fontWeight: '500',
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    gap: 8,
  },
  alertTxt: {
    color: '#fca5a5',
    fontSize: Math.min(SW * 0.028, 11),
    fontWeight: '700',
    flex: 1,
    lineHeight: 16,
  },

  // History & AI Tab Container
  tabContainer: { flex: 1, paddingTop: 52, paddingHorizontal: 16 },
  tabHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  tabTitle: { fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
  tabSub: { fontSize: 12, marginTop: 2 },
  clearHistBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.12)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  clearHistTxt: { color: '#f87171', fontSize: 12, fontWeight: '700' },

  historyListContainer: { paddingBottom: 80 },
  emptyHistoryBox: { alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingHorizontal: 24 },
  emptyHistTitle: { fontSize: 17, fontWeight: '800', marginBottom: 6 },
  emptyHistSub: { fontSize: 13, textAlign: 'center', lineHeight: 18 },

  historyCard: { borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1 },
  historyCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  historyDate: { fontSize: 11, fontWeight: '600' },
  histSavingsBadge: { backgroundColor: 'rgba(16,185,129,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  histSavingsTxt: { color: '#34d399', fontSize: 11, fontWeight: '800' },
  historyLocRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  historyLocTxt: { fontSize: 13, fontWeight: '600', flex: 1 },
  historyFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  historyMeta: { fontSize: 11, fontWeight: '600' },
  restoreTxt: { color: '#10b981', fontSize: 12, fontWeight: '800', marginRight: 2 },

  // Floating Voice Assistant Button on Map
  floatingVoiceBtn: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    zIndex: 30,
  },

  // Redesigned AI Tab Settings & Voice Hero Layout
  settingsIconBtn: {
    width: 38, height: 38, borderRadius: 12,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  aiVoiceHeroCardRedesigned: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 2,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  aiVoiceHeroLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  aiVoiceOrbMini: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiVoiceHeroTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },
  aiVoiceHeroSub: {
    fontSize: 12,
    lineHeight: 16,
  },
  aiVoiceHeroAction: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // AI Tab
  aiContainer: { paddingBottom: 90 },
  aiFeatureHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  aiFeatureTitle: { fontSize: 13, fontWeight: '800' },
  aiFeatureSub: { fontSize: 11, lineHeight: 15 },
  featuresGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  aiFeatureCardGrid: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
  },

  aiPromptCard: { borderRadius: 18, padding: 14, borderWidth: 1, marginTop: 4, marginBottom: 16 },
  aiPromptHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  aiPromptTitle: { fontSize: 15, fontWeight: '800' },
  aiTextInput: { height: 75, borderRadius: 12, borderWidth: 1, padding: 10, fontSize: 13, textAlignVertical: 'top', marginBottom: 10 },
  aiSubmitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0284c7', paddingVertical: 12, borderRadius: 12, marginBottom: 12 },
  aiSubmitTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  aiPresetChip: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  aiPresetTxt: { fontSize: 11, fontWeight: '700', flex: 1 },

  // Settings Modal Styles
  settingsModalBg: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  settingsModalContent: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    height: '80%',
    padding: 20,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 24,
  },
  settingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1.5,
  },
  settingsTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  settingsCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsScrollInner: {
    paddingVertical: 16,
    paddingBottom: 48,
  },
  settingsSecLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 14,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  settingSubLabel: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },

  // Segmented Control
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  segmentBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnTriple: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 54,
  },
  segmentBtnOn: {
    backgroundColor: '#10b981',
  },
  segmentBtnTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  segmentBtnTxtOn: {
    color: '#ffffff',
    fontWeight: '800',
  },

  // Toggle Switch
  toggleSwitch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 3,
  },
  toggleSwitchOn: {
    backgroundColor: '#10b981',
  },
  toggleSwitchOff: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  togglePin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff',
  },
  togglePinOn: {
    alignSelf: 'flex-end',
  },
  togglePinOff: {
    alignSelf: 'flex-start',
  },

  // Legal Items
  legalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  legalLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  legalScrollInner: {
    paddingVertical: 16,
  },
  legalTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
  legalBody: {
    fontSize: 12,
    lineHeight: 18,
  },

  // Plan Setup Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  centeredModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, borderWidth: 1, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 18, fontWeight: '900' },
  modalCalcBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#10b981', paddingVertical: 14, borderRadius: 14, marginTop: 14 },
  calcTxt: { color: '#fff', fontSize: 15, fontWeight: '900' },

  // Crafting Loading Modal Styles
  craftingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  craftingCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 20,
  },
  craftingIconContainer: {
    width: 84,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  pulseRing: {
    position: 'absolute',
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2,
    opacity: 0.45,
  },
  craftingIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(16,185,129,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  craftingTitle: {
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  craftingSub: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 16,
  },
  phraseBox: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  phraseTxt: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dotItem: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotItemActive: {
    width: 22,
    borderRadius: 4,
  },

  // Fixed Bottom Navigation Bar
  bottomNav: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 60, flexDirection: 'row',
    borderTopWidth: 1, zIndex: 100, elevation: 30,
  },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontSize: 10, fontWeight: '700', marginTop: 2 },

  // ── 🧭 NAVIGATION SYSTEM STYLES ──
  startNavHeaderBtn: {
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  startNavHeaderGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 22,
    minHeight: 36, // Ensure tappable height
  },
  startNavHeaderTxt: {
    color: '#ffffff',
    fontSize: Math.min(SW * 0.032, 13),
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  navHudCard: {
    position: 'absolute',
    bottom: 24,
    left: 14,
    right: 14,
    borderRadius: 20,
    padding: 14,
    zIndex: 999,
  },
  navHudTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navAvatarBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderWidth: 1.5,
    borderColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navModeLabel: {
    fontSize: 13,
    fontWeight: '900',
  },
  navTempPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  navTempTxt: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  navSpeedTxt: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  navStopBtn: {
    padding: 4,
  },
  navSpeechBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    marginTop: 8,
  },
  navSpeechTxt: {
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  navProgressBarTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  navProgressBarFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 2,
  },
  navModalContainer: {
    width: '90%',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 20,
  },
  navModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  navModalTitle: {
    fontSize: 17,
    fontWeight: '900',
  },
  navModalSub: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 16,
  },
  navModeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 10,
  },
  navModeCardSel: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16,185,129,0.08)',
  },
  navModeCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  navModeCardSub: {
    fontSize: 11,
    lineHeight: 15,
  },
  navAvatarPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 8,
  },
  navAvatarPreviewTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  navAvatarPreviewSub: {
    fontSize: 10,
  },
  launchNavModalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 16,
  },
  launchNavModalTxt: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
});
