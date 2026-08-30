import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Animated,
  Easing,
  Modal,
  Platform,
  Dimensions,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system';
import {
  callAssistantBackend,
  transcribeAudio,
  AssistantChatMessage,
  AssistantChatContext,
} from '../services/voiceAssistant';

const { width: SW, height: SH } = Dimensions.get('window');

function createBrowserSpeechModule() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  let recognition: any = null;
  const emit = (name: string, event: any = {}) => listeners.get(name)?.forEach(listener => listener(event));

  return {
    addListener(name: string, listener: (event: any) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return { remove: () => listeners.get(name)?.delete(listener) };
    },
    async requestPermissionsAsync() {
      return { granted: true, status: 'granted' };
    },
    getSpeechRecognitionServices() {
      return [];
    },
    start(options: any = {}) {
      const browserWindow = window as any;
      const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
      if (!Recognition) {
        emit('error', { error: 'not-supported', message: 'Speech recognition is unavailable in this browser.' });
        return;
      }

      recognition?.abort?.();
      recognition = new Recognition();
      recognition.lang = options.lang || 'en-US';
      recognition.continuous = Boolean(options.continuous);
      recognition.interimResults = options.interimResults !== false;
      recognition.maxAlternatives = options.maxAlternatives || 1;
      recognition.onstart = () => emit('start');
      recognition.onend = () => emit('end');
      recognition.onerror = (event: any) => emit('error', event);
      recognition.onresult = (event: any) => {
        const results = Array.from(event.results || []).map((result: any) => ({
          transcript: result?.[0]?.transcript || '',
          isFinal: Boolean(result?.isFinal),
        }));
        emit('result', {
          results,
          isFinal: results.length > 0 && results[results.length - 1].isFinal,
        });
      };
      recognition.start();
    },
    stop() {
      recognition?.stop?.();
    },
    abort() {
      recognition?.abort?.();
      recognition = null;
    },
  };
}

const ExpoSpeechRecognitionModule: any = Platform.OS === 'web'
  ? createBrowserSpeechModule()
  : require('expo-speech-recognition').ExpoSpeechRecognitionModule;

interface CoolPathAssistantModalProps {
  visible: boolean;
  onClose: () => void;
  currentOriginText: string;
  currentDestText: string;
  liveTempC: number | null;
  liveAqi: number | null;
  onPlanRouteAction: (originText: string, destText: string, activity?: string, pace?: string, mode?: string) => void;
  onRegisterSpeakFn?: (fn: (text: string) => void) => void;
  theme: {
    bg: string;
    cardBg: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    inputBg: string;
    isDark: boolean;
  };
}

type ActivityOption = 'walking' | 'running' | 'biking' | 'driving';
type PaceOption = 'slow' | 'normal' | 'fast';
type TripMode = 'instant' | 'scheduled';

type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking';

const CONTEXT_PHRASES = [
  'CoolPath', 'cool route', 'shaded route', 'heat safe',
  'Central Park', 'Times Square', 'Brooklyn', 'Manhattan',
  'current location', 'walking', 'running', 'biking', 'driving',
  'navigate', 'plan route', 'go to', 'take me to',
];

function cleanForSpeech(text: string): string {
  return text
    .replace(/[*_~`#>•\-]/g, ' ')
    .replace(/\n+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTranscript(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\bst\.?\s+garden\b/gi, 'city garden')
    .replace(/\bciti\s+garden\b/gi, 'city garden')
    .trim();
}

// Animated Orb Component
const VoiceOrb: React.FC<{ state: AssistantState; micVolume: number }> = ({ state, micVolume }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const ringScale1 = useRef(new Animated.Value(1)).current;
  const ringScale2 = useRef(new Animated.Value(1)).current;
  const ringScale3 = useRef(new Animated.Value(1)).current;
  const ringOpacity1 = useRef(new Animated.Value(0.6)).current;
  const ringOpacity2 = useRef(new Animated.Value(0.4)).current;
  const ringOpacity3 = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    pulseAnim.stopAnimation();
    rotateAnim.stopAnimation();
    glowAnim.stopAnimation();
    ringScale1.stopAnimation();
    ringScale2.stopAnimation();
    ringScale3.stopAnimation();

    if (state === 'idle') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.95, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
      Animated.timing(glowAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }).start();
    } else if (state === 'listening') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.9, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
      Animated.timing(glowAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      // Ripple rings
      const createRipple = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.parallel([
              Animated.timing(scale, { toValue: 2.2, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0.6, duration: 0, useNativeDriver: true }),
            ]),
          ])
        );
      createRipple(ringScale1, ringOpacity1, 0).start();
      createRipple(ringScale2, ringOpacity2, 600).start();
      createRipple(ringScale3, ringOpacity3, 1200).start();
    } else if (state === 'thinking') {
      Animated.loop(
        Animated.timing(rotateAnim, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true })
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.92, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
      Animated.timing(glowAnim, { toValue: 0.7, duration: 400, useNativeDriver: true }).start();
    } else if (state === 'speaking') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.88, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
      Animated.timing(glowAnim, { toValue: 0.85, duration: 300, useNativeDriver: true }).start();
      // Gentle ripples for speaking
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ringScale1, { toValue: 1.8, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            Animated.timing(ringOpacity1, { toValue: 0, duration: 1200, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ringScale1, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ringOpacity1, { toValue: 0.4, duration: 0, useNativeDriver: true }),
          ]),
        ])
      ).start();
    }

    return () => {
      pulseAnim.stopAnimation();
      rotateAnim.stopAnimation();
      glowAnim.stopAnimation();
      ringScale1.stopAnimation();
      ringScale2.stopAnimation();
      ringScale3.stopAnimation();
    };
  }, [state]);

  const spin = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const orbColors = {
    idle: { bg: '#1e293b', border: 'rgba(99, 102, 241, 0.4)', glow: 'rgba(99, 102, 241, 0.3)' },
    listening: { bg: '#065f46', border: '#10B981', glow: 'rgba(16, 185, 129, 0.5)' },
    thinking: { bg: '#4c1d95', border: '#A855F7', glow: 'rgba(168, 85, 247, 0.4)' },
    speaking: { bg: '#0c4a6e', border: '#38BDF8', glow: 'rgba(56, 189, 248, 0.4)' },
  };

  const colors = orbColors[state];

  const ringColor = state === 'listening' ? 'rgba(16, 185, 129, 0.4)' : state === 'speaking' ? 'rgba(56, 189, 248, 0.3)' : 'transparent';

  return (
    <View style={styles.orbContainer}>
      {/* Ripple rings */}
      {(state === 'listening' || state === 'speaking') && (
        <>
          <Animated.View style={[styles.rippleRing, { transform: [{ scale: ringScale1 }], opacity: ringOpacity1, borderColor: ringColor }]} />
          <Animated.View style={[styles.rippleRing, { transform: [{ scale: ringScale2 }], opacity: ringOpacity2, borderColor: ringColor }]} />
          <Animated.View style={[styles.rippleRing, { transform: [{ scale: ringScale3 }], opacity: ringOpacity3, borderColor: ringColor }]} />
        </>
      )}

      {/* Glow backdrop */}
      <Animated.View style={[styles.orbGlow, { opacity: glowAnim, backgroundColor: colors.glow }]} />

      {/* Main orb */}
      <Animated.View
        style={[
          styles.orbMain,
          {
            backgroundColor: colors.bg,
            borderColor: colors.border,
            transform: [{ scale: pulseAnim }, ...(state === 'thinking' ? [{ rotate: spin }] : [])],
          },
        ]}
      >
        <Ionicons
          name={state === 'listening' ? 'mic' : state === 'thinking' ? 'sparkles' : state === 'speaking' ? 'volume-high' : 'mic-outline'}
          size={32}
          color={state === 'idle' ? '#94a3b8' : '#ffffff'}
        />
      </Animated.View>
    </View>
  );
};

// Message Bubble Component
const MessageBubble: React.FC<{ message: AssistantChatMessage; isLatest: boolean }> = ({ message, isLatest }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 350, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
    ]).start();
  }, []);

  if (message.role === 'user') {
    return (
      <Animated.View style={[styles.userBubble, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <Text style={styles.userBubbleText}>{message.content}</Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.assistantBubble, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.assistantBubbleHeader}>
        <View style={styles.assistantAvatarSmall}>
          <Ionicons name="sparkles" size={10} color="#10B981" />
        </View>
        <Text style={styles.assistantLabel}>CoolPath</Text>
      </View>
      <Text style={styles.assistantBubbleText}>
        {message.display_text || message.content}
      </Text>
    </Animated.View>
  );
};

export const CoolPathAssistantModal: React.FC<CoolPathAssistantModalProps> = ({
  visible,
  onClose,
  currentOriginText,
  currentDestText,
  liveTempC,
  liveAqi,
  onPlanRouteAction,
  onRegisterSpeakFn,
  theme,
}) => {
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [assistantState, setAssistantState] = useState<AssistantState>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [pendingAction, setPendingAction] = useState<any>(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [micVolume, setMicVolume] = useState(0);
  const [showTripConfig, setShowTripConfig] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<ActivityOption>('walking');
  const [selectedPace, setSelectedPace] = useState<PaceOption>('normal');
  const [selectedMode, setSelectedMode] = useState<TripMode>('instant');

  const stateRef = useRef<AssistantState>('idle');
  const isSubmittingRef = useRef(false);
  const latestTranscriptRef = useRef('');
  const activeSessionRef = useRef(0);
  const listenTimerRef = useRef<NodeJS.Timeout | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const hasGreetedRef = useRef(false);

  // Animation values
  const containerFade = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(-60)).current;
  const controlsSlide = useRef(new Animated.Value(100)).current;

  const setState = useCallback((s: AssistantState) => {
    stateRef.current = s;
    setAssistantState(s);
  }, []);

  // Entrance animation
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(containerFade, { toValue: 1, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.spring(headerSlide, { toValue: 0, tension: 60, friction: 12, useNativeDriver: true }),
        Animated.spring(controlsSlide, { toValue: 0, tension: 50, friction: 12, useNativeDriver: true }),
      ]).start();
    } else {
      containerFade.setValue(0);
      headerSlide.setValue(-60);
      controlsSlide.setValue(100);
    }
  }, [visible]);

  // Speech recognition event listeners
  useEffect(() => {
    const speechModule = ExpoSpeechRecognitionModule as any;
    const subs = [
      speechModule.addListener('start', () => {
        if (stateRef.current === 'listening') {
          setLiveTranscript('');
        }
      }),
      speechModule.addListener('result', (event: any) => {
        if (stateRef.current !== 'listening') return;

        const results = event.results || [];
        const isFinal = event.isFinal || (results.length > 0 && results[results.length - 1]?.isFinal);

        // Get the best transcript - take the last result's transcript for incremental updates
        let bestText = '';
        for (const r of results) {
          if (r.transcript) {
            bestText = r.transcript;
          }
        }

        const normalized = normalizeTranscript(bestText);
        if (!normalized) return;

        latestTranscriptRef.current = normalized;
        setLiveTranscript(normalized);

        // Reset silence timer on each new result
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }

        // If final result from recognition engine, submit immediately
        if (isFinal && normalized.length > 1) {
          submitTranscript(normalized);
        } else {
          // Wait for 2s of silence after last partial to auto-submit
          silenceTimerRef.current = setTimeout(() => {
            const current = latestTranscriptRef.current.trim();
            if (current && stateRef.current === 'listening' && !isSubmittingRef.current) {
              submitTranscript(current);
            }
          }, 2000);
        }
      }),
      speechModule.addListener('end', () => {
        if (stateRef.current === 'listening') {
          // Recognition ended - submit whatever we have
          const transcript = latestTranscriptRef.current.trim();
          if (transcript && !isSubmittingRef.current) {
            submitTranscript(transcript);
          } else if (!isSubmittingRef.current) {
            setState('idle');
          }
        }
      }),
      speechModule.addListener('error', (event: any) => {
        if (event.error === 'aborted') return;
        if (event.error === 'no-speech') {
          // Try the persisted audio file via backend
          setState('idle');
          setLiveTranscript('');
          return;
        }
        console.warn('[STT Error]', event.error);
        setState('idle');
        setLiveTranscript('');
      }),
      speechModule.addListener('volumechange', (event: any) => {
        if (stateRef.current === 'listening') {
          const vol = Math.max(0, (event.value + 2) * 10);
          setMicVolume(vol);
        }
      }),
      speechModule.addListener('audioend', async (event: any) => {
        // Backend transcription as backup when on-device didn't produce a good result
        if (isSubmittingRef.current) return;

        const onDeviceTranscript = latestTranscriptRef.current.trim();

        // If on-device already got a good result (3+ chars), use it directly
        if (onDeviceTranscript.length >= 3) {
          if (!isSubmittingRef.current) {
            submitTranscript(onDeviceTranscript);
          }
          return;
        }

        // Otherwise try backend transcription from audio file
        if (event.uri) {
          try {
            setState('thinking');
            setLiveTranscript('Processing speech...');
            const base64Audio = await FileSystem.readAsStringAsync(event.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            try { await FileSystem.deleteAsync(event.uri, { idempotent: true }); } catch {}

            const mimeType = Platform.OS === 'ios' ? 'audio/wav' : 'audio/amr';
            const transcript = await transcribeAudio(base64Audio, mimeType);

            if (transcript && transcript.trim().length >= 2) {
              submitTranscript(transcript.trim());
            } else if (onDeviceTranscript) {
              submitTranscript(onDeviceTranscript);
            } else {
              setState('idle');
              setLiveTranscript('');
              addAssistantMessage(
                "I didn't catch that. Please try again or tap the keyboard icon to type.",
                "I couldn't hear you clearly. Please try again or use the keyboard.",
                ['Plan route to Central Park', 'Check weather']
              );
            }
          } catch (err) {
            if (onDeviceTranscript) {
              submitTranscript(onDeviceTranscript);
            } else {
              setState('idle');
              setLiveTranscript('');
            }
          }
        }
      }),
    ];

    return () => { subs.forEach((s: any) => s?.remove?.()); };
  }, []);

  const submitTranscript = useCallback((text: string) => {
    if (isSubmittingRef.current || !text.trim()) return;
    isSubmittingRef.current = true;
    clearTimers();
    handleSendPrompt(text.trim());
  }, []);

  const clearTimers = () => {
    if (listenTimerRef.current) { clearTimeout(listenTimerRef.current); listenTimerRef.current = null; }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  };

  const addAssistantMessage = (spoken: string, display: string, suggestions: string[], action?: string, actionData?: any) => {
    const msg: AssistantChatMessage = {
      role: 'assistant',
      content: spoken,
      display_text: display,
      action: action || null,
      action_data: actionData || null,
      suggested_replies: suggestions,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 150);
  };

  const shouldAutoListenRef = useRef(true);

  const speakText = useCallback((text: string, onDone?: () => void, skipAutoListen?: boolean) => {
    if (isMuted || !text) {
      setState('idle');
      onDone?.();
      return;
    }

    if (skipAutoListen) {
      shouldAutoListenRef.current = false;
    } else {
      shouldAutoListenRef.current = true;
    }

    setState('speaking');
    const cleanText = cleanForSpeech(text);

    Speech.speak(cleanText, {
      language: 'en-US',
      pitch: 1.0,
      rate: Platform.OS === 'ios' ? 0.52 : 0.95,
      onDone: () => {
        setState('idle');
        onDone?.();
        // Auto-listen after speaking (conversational loop) — skip if route is being executed
        if (shouldAutoListenRef.current && !isMuted && visible) {
          setTimeout(() => startListening(), 600);
        }
      },
      onError: () => {
        setState('idle');
        onDone?.();
      },
    });
  }, [isMuted, visible]);

  const startListening = useCallback(async () => {
    if (stateRef.current === 'thinking' || stateRef.current === 'speaking') return;
    if (stateRef.current === 'listening') return;

    isSubmittingRef.current = false;
    latestTranscriptRef.current = '';
    setLiveTranscript('');
    setMicVolume(0);
    setState('listening');

    try {
      if (Platform.OS === 'ios') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      }

      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setState('idle');
        addAssistantMessage(
          'Microphone permission needed. Please allow access or use keyboard mode.',
          'Microphone permission is required for voice commands. Please enable it in settings or use keyboard mode.',
          ['Use keyboard', 'Plan route to Central Park']
        );
        return;
      }

      let androidService: string | undefined;
      if (Platform.OS === 'android') {
        try {
          const services = ExpoSpeechRecognitionModule.getSpeechRecognitionServices();
          androidService =
            services.find((s: string) => s.includes('googlequicksearchbox')) ||
            services.find((s: string) => s.includes('com.google.android.as')) ||
            services.find((s: string) => s.includes('google'));
        } catch {}
      }

      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        contextualStrings: [...CONTEXT_PHRASES, currentOriginText, currentDestText].filter(Boolean),
        addsPunctuation: true,
        androidRecognitionServicePackage: androidService,
        recordingOptions: { persist: true },
        volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
        androidIntentOptions: {
          EXTRA_LANGUAGE_MODEL: 'free_form',
          EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 2000,
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1800,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 1500,
        },
        iosTaskHint: 'dictation',
      });

      // Safety timeout - auto submit after 12 seconds
      clearTimers();
      listenTimerRef.current = setTimeout(() => {
        const transcript = latestTranscriptRef.current.trim();
        if (stateRef.current === 'listening') {
          if (transcript && !isSubmittingRef.current) {
            submitTranscript(transcript);
          } else {
            stopListening();
          }
        }
      }, 12000);
    } catch (err) {
      console.warn('[STT Start Error]', err);
      setState('idle');
    }
  }, [currentOriginText, currentDestText]);

  const stopListening = useCallback(() => {
    clearTimers();
    setState('idle');
    setLiveTranscript('');
    try { ExpoSpeechRecognitionModule.stop(); } catch {}
  }, []);

  const stopAll = useCallback(() => {
    activeSessionRef.current += 1;
    clearTimers();
    isSubmittingRef.current = false;
    setState('idle');
    setLiveTranscript('');
    setMicVolume(0);
    try { ExpoSpeechRecognitionModule.abort(); } catch {}
    try { Speech.stop(); } catch {}
  }, []);

  // Initial greeting
  useEffect(() => {
    if (visible) {
      activeSessionRef.current += 1;
      hasGreetedRef.current = false;
      isSubmittingRef.current = false;

      const greeting: AssistantChatMessage = {
        role: 'assistant',
        content: "Hi! I'm CoolPath Assistant. Where would you like to go today?",
        display_text: "Hi! I'm CoolPath Assistant. I find heat-safe, shaded routes through the city.\n\nTell me your destination or ask about the weather.",
        suggested_replies: ['Plan route to Central Park', 'Times Square to Brooklyn', 'Check weather'],
        timestamp: Date.now(),
      };
      setMessages([greeting]);

      const timer = setTimeout(() => {
        if (!hasGreetedRef.current) {
          hasGreetedRef.current = true;
          speakText("Hi! I'm CoolPath Assistant. Where would you like to go today?");
        }
      }, 600);

      return () => { clearTimeout(timer); stopAll(); };
    } else {
      stopAll();
    }
  }, [visible]);

  const handleSendPrompt = async (textToSend: string) => {
    if (!textToSend?.trim() || stateRef.current === 'thinking') return;

    const session = activeSessionRef.current;
    const userText = normalizeTranscript(textToSend);
    setInputText('');
    setLiveTranscript('');
    stopListening();

    const userMsg: AssistantChatMessage = { role: 'user', content: userText, timestamp: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);

    setState('thinking');

    const context: AssistantChatContext = {
      current_origin: currentOriginText,
      current_dest: currentDestText,
      temp_c: liveTempC ?? 30,
      aqi: liveAqi ?? 45,
      pending_action: pendingAction,
    };

    try {
      const response = await callAssistantBackend(
        newMessages.map(m => ({ role: m.role, content: m.content })),
        context
      );

      if (session !== activeSessionRef.current) return;
      isSubmittingRef.current = false;
      setState('idle');

      const assistantMsg: AssistantChatMessage = {
        role: 'assistant',
        content: response.spoken_response,
        display_text: response.display_text,
        action: response.action,
        action_data: response.action_data,
        suggested_replies: response.suggested_replies || [],
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMsg]);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);

      let routeToExecute: any = null;

      if (response.action_data || response.action === 'confirm_route' || response.action === 'execute_route') {
        const actionData = response.action_data || {
          origin: currentOriginText,
          destination: currentDestText,
          activity: 'walking',
        };

        if (response.action === 'execute_route') {
          routeToExecute = actionData;
        } else {
          setPendingAction(actionData);
          if (actionData.activity) setSelectedActivity(actionData.activity as ActivityOption);
          setShowTripConfig(true);
        }
      }

      const skipListen = response.action === 'execute_route';
      speakText(response.spoken_response, () => {
        if (routeToExecute && session === activeSessionRef.current) {
          executeRoute(routeToExecute);
        }
      }, skipListen);
    } catch (err) {
      if (session !== activeSessionRef.current) return;
      isSubmittingRef.current = false;
      setState('idle');
      addAssistantMessage(
        "I'm having trouble connecting. Please try again.",
        "Connection error. Please check your network and try again.",
        ['Try again', 'Use keyboard']
      );
    }
  };

  const executeRoute = (actionData: any) => {
    const orig = actionData?.origin || currentOriginText;
    const dest = actionData?.destination || currentDestText;
    const act = actionData?.activity || selectedActivity;
    setPendingAction(null);
    setShowTripConfig(false);
    stopAll();
    onPlanRouteAction(orig, dest, act, selectedPace, selectedMode);
    onClose();
  };

  const handleMicPress = () => {
    if (assistantState === 'speaking') {
      Speech.stop();
      setState('idle');
      return;
    }
    if (assistantState === 'listening') {
      const transcript = latestTranscriptRef.current.trim();
      if (transcript) {
        submitTranscript(transcript);
      } else {
        stopListening();
      }
      return;
    }
    if (assistantState === 'thinking') return;
    startListening();
  };

  const handleClose = () => {
    stopAll();
    onClose();
  };

  const handleSuggestedReply = (reply: string) => {
    isSubmittingRef.current = false;
    handleSendPrompt(reply);
  };

  const lastMsg = messages[messages.length - 1];

  const stateLabel = {
    idle: 'Tap to speak',
    listening: 'Listening...',
    thinking: 'Processing...',
    speaking: 'Speaking...',
  }[assistantState];

  return (
    <Modal visible={visible} animationType="none" transparent={false} onRequestClose={handleClose}>
      <Animated.View style={[styles.container, { opacity: containerFade }]}>
        {/* Header */}
        <Animated.View style={[styles.header, { transform: [{ translateY: headerSlide }] }]}>
          <View style={styles.headerLeft}>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          </View>
          <Text style={styles.headerTitle}>CoolPath Assistant</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={[styles.headerBtn, isMuted && styles.headerBtnActive]}
              onPress={() => { if (!isMuted) stopAll(); setIsMuted(m => !m); }}
              activeOpacity={0.7}
            >
              <Ionicons name={isMuted ? 'volume-mute' : 'volume-high'} size={18} color={isMuted ? '#EF4444' : '#e2e8f0'} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerBtn} onPress={handleClose} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color="#e2e8f0" />
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Messages */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesArea}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((msg, i) => (
            <MessageBubble key={`${msg.timestamp}-${i}`} message={msg} isLatest={i === messages.length - 1} />
          ))}

          {/* Thinking indicator */}
          {assistantState === 'thinking' && (
            <View style={styles.thinkingBubble}>
              <View style={styles.thinkingDots}>
                <ThinkingDot delay={0} />
                <ThinkingDot delay={200} />
                <ThinkingDot delay={400} />
              </View>
            </View>
          )}

          {/* Trip config selector card */}
          {showTripConfig && pendingAction && (
            <TripConfigCard
              actionData={pendingAction}
              currentOrigin={currentOriginText}
              currentDest={currentDestText}
              selectedActivity={selectedActivity}
              selectedPace={selectedPace}
              selectedMode={selectedMode}
              onActivityChange={setSelectedActivity}
              onPaceChange={setSelectedPace}
              onModeChange={setSelectedMode}
              onConfirm={() => executeRoute({ ...pendingAction, activity: selectedActivity })}
              onDismiss={() => { setPendingAction(null); setShowTripConfig(false); }}
            />
          )}
        </ScrollView>

        {/* Controls */}
        <Animated.View style={[styles.controls, { transform: [{ translateY: controlsSlide }] }]}>
          {/* Live transcript */}
          {assistantState === 'listening' && liveTranscript ? (
            <View style={styles.transcriptPill}>
              <View style={styles.recordingDot} />
              <Text style={styles.transcriptText} numberOfLines={2}>{liveTranscript}</Text>
            </View>
          ) : null}

          {/* Voice orb */}
          <TouchableOpacity onPress={handleMicPress} activeOpacity={0.85} style={styles.orbTouchArea}>
            <VoiceOrb state={assistantState} micVolume={micVolume} />
          </TouchableOpacity>

          <Text style={styles.stateLabel}>{stateLabel}</Text>

          {/* Suggested replies */}
          {lastMsg?.suggested_replies && lastMsg.suggested_replies.length > 0 && assistantState === 'idle' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.suggestionsRow}
              contentContainerStyle={styles.suggestionsContent}
            >
              {lastMsg.suggested_replies.map((reply, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.suggestionChip}
                  onPress={() => handleSuggestedReply(reply)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.suggestionText}>{reply}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Keyboard input */}
          <View style={styles.inputArea}>
            {showKeyboard ? (
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Type your message..."
                  placeholderTextColor="#64748b"
                  value={inputText}
                  onChangeText={setInputText}
                  onSubmitEditing={() => {
                    if (inputText.trim()) {
                      isSubmittingRef.current = false;
                      handleSendPrompt(inputText);
                      setShowKeyboard(false);
                    }
                  }}
                  returnKeyType="send"
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
                  onPress={() => {
                    if (inputText.trim()) {
                      isSubmittingRef.current = false;
                      handleSendPrompt(inputText);
                      setShowKeyboard(false);
                    }
                  }}
                  disabled={!inputText.trim()}
                  activeOpacity={0.7}
                >
                  <Ionicons name="arrow-up" size={18} color="#ffffff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.closeKeyboardBtn} onPress={() => setShowKeyboard(false)}>
                  <Ionicons name="mic" size={18} color="#94a3b8" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.keyboardToggle} onPress={() => setShowKeyboard(true)} activeOpacity={0.7}>
                <Ionicons name="chatbox-outline" size={16} color="#64748b" />
                <Text style={styles.keyboardToggleText}>Type instead</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

// Thinking dots animation
const ThinkingDot: React.FC<{ delay: number }> = ({ delay }) => {
  const anim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 400, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  return <Animated.View style={[styles.dot, { opacity: anim }]} />;
};

// Route action card
const ACTIVITY_OPTIONS: { id: ActivityOption; label: string; icon: string }[] = [
  { id: 'walking', label: 'Walk', icon: 'walking' },
  { id: 'running', label: 'Run', icon: 'running' },
  { id: 'biking', label: 'Bike', icon: 'bicycle' },
  { id: 'driving', label: 'Drive', icon: 'car' },
];

const PACE_OPTIONS: { id: PaceOption; label: string }[] = [
  { id: 'slow', label: 'Relaxed' },
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Paced' },
];

const MODE_OPTIONS: { id: TripMode; label: string; desc: string }[] = [
  { id: 'instant', label: 'Quick', desc: 'Leave now' },
  { id: 'scheduled', label: 'Scheduled', desc: 'Optimal timing' },
];

const TripConfigCard: React.FC<{
  actionData: any;
  currentOrigin: string;
  currentDest: string;
  selectedActivity: ActivityOption;
  selectedPace: PaceOption;
  selectedMode: TripMode;
  onActivityChange: (a: ActivityOption) => void;
  onPaceChange: (p: PaceOption) => void;
  onModeChange: (m: TripMode) => void;
  onConfirm: () => void;
  onDismiss: () => void;
}> = ({ actionData, currentOrigin, currentDest, selectedActivity, selectedPace, selectedMode, onActivityChange, onPaceChange, onModeChange, onConfirm, onDismiss }) => {
  const slideAnim = useRef(new Animated.Value(40)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, []);

  const origin = actionData?.origin || currentOrigin || 'Current Location';
  const destination = actionData?.destination || currentDest || 'Destination';

  return (
    <Animated.View style={[styles.actionCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      {/* Route header */}
      <View style={styles.actionCardHeader}>
        <FontAwesome5 name="route" size={14} color="#10B981" />
        <Text style={styles.actionCardTitle}>Configure Trip</Text>
      </View>

      {/* Route display */}
      <View style={styles.actionCardRoute}>
        <View style={styles.routePoint}>
          <View style={styles.routeDotGreen} />
          <Text style={styles.routeText} numberOfLines={1}>{origin}</Text>
        </View>
        <View style={styles.routeLine} />
        <View style={styles.routePoint}>
          <View style={styles.routeDotRed} />
          <Text style={styles.routeText} numberOfLines={1}>{destination}</Text>
        </View>
      </View>

      {/* Trip Mode selector */}
      <View style={styles.configSection}>
        <Text style={styles.configLabel}>Trip Type</Text>
        <View style={styles.configRow}>
          {MODE_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.id}
              style={[styles.configChip, selectedMode === opt.id && styles.configChipActive]}
              onPress={() => onModeChange(opt.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.configChipText, selectedMode === opt.id && styles.configChipTextActive]}>{opt.label}</Text>
              <Text style={[styles.configChipDesc, selectedMode === opt.id && styles.configChipDescActive]}>{opt.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Activity selector */}
      <View style={styles.configSection}>
        <Text style={styles.configLabel}>Travel By</Text>
        <View style={styles.configRow}>
          {ACTIVITY_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.id}
              style={[styles.activityChip, selectedActivity === opt.id && styles.activityChipActive]}
              onPress={() => onActivityChange(opt.id)}
              activeOpacity={0.7}
            >
              <FontAwesome5 name={opt.icon} size={12} color={selectedActivity === opt.id ? '#fff' : '#94a3b8'} />
              <Text style={[styles.activityChipText, selectedActivity === opt.id && styles.activityChipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Pace selector */}
      <View style={styles.configSection}>
        <Text style={styles.configLabel}>Pace</Text>
        <View style={styles.configRow}>
          {PACE_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.id}
              style={[styles.configChip, selectedPace === opt.id && styles.configChipActive]}
              onPress={() => onPaceChange(opt.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.configChipText, selectedPace === opt.id && styles.configChipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actionCardButtons}>
        <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm} activeOpacity={0.8}>
          <Ionicons name="navigate" size={16} color="#fff" />
          <Text style={styles.confirmBtnText}>Plan Route</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss} activeOpacity={0.8}>
          <Text style={styles.dismissBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingBottom: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  headerLeft: {
    width: 70,
  },
  headerTitle: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
    width: 70,
    justifyContent: 'flex-end',
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 5,
  },
  liveText: {
    color: '#10B981',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  // Messages
  messagesArea: {
    flex: 1,
  },
  messagesContent: {
    padding: 20,
    paddingBottom: 10,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#6366f1',
    borderRadius: 20,
    borderBottomRightRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: '80%',
    marginBottom: 12,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  userBubbleText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 20,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '88%',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  assistantBubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  assistantAvatarSmall: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  assistantLabel: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '700',
  },
  assistantBubbleText: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '400',
  },
  // Thinking
  thinkingBubble: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  thinkingDots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  // Controls
  controls: {
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    paddingTop: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.98)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
  },
  transcriptPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '85%',
    marginBottom: 16,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    marginRight: 8,
  },
  transcriptText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  // Orb
  orbTouchArea: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbContainer: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  orbMain: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  rippleRing: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
  },
  stateLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
    letterSpacing: 0.3,
  },
  // Suggestions
  suggestionsRow: {
    maxHeight: 40,
    width: SW,
    marginTop: 16,
  },
  suggestionsContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  suggestionChip: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.2)',
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  suggestionText: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '600',
  },
  // Input
  inputArea: {
    width: '100%',
    paddingHorizontal: 20,
    marginTop: 16,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  textInput: {
    flex: 1,
    height: 42,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 21,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    color: '#e2e8f0',
    paddingHorizontal: 16,
    fontSize: 14,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  closeKeyboardBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  keyboardToggleText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  // Action Card
  actionCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  actionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  actionCardTitle: {
    color: '#10B981',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  actionActivityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  actionActivityText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  actionCardRoute: {
    marginBottom: 14,
  },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  routeDotGreen: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
  },
  routeDotRed: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  routeLine: {
    width: 2,
    height: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginLeft: 4,
    marginVertical: 2,
  },
  routeText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  actionCardButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#10B981',
    paddingVertical: 10,
    borderRadius: 12,
  },
  confirmBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  dismissBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  dismissBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  // Trip Config Card styles
  configSection: {
    marginBottom: 12,
  },
  configLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  configRow: {
    flexDirection: 'row',
    gap: 8,
  },
  configChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  configChipActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: '#6366f1',
  },
  configChipText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  configChipTextActive: {
    color: '#a5b4fc',
  },
  configChipDesc: {
    color: '#475569',
    fontSize: 9,
    fontWeight: '500',
    marginTop: 2,
  },
  configChipDescActive: {
    color: '#818cf8',
  },
  activityChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  activityChipActive: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  activityChipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  activityChipTextActive: {
    color: '#ffffff',
  },
});
