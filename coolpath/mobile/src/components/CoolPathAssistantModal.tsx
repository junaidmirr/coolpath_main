import React, { useState, useEffect, useRef } from 'react';
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
  ActivityIndicator,
  Dimensions,
  SafeAreaView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import {
  callAssistantBackend,
  transcribeAudio,
  AssistantChatMessage,
  AssistantChatContext,
} from '../services/voiceAssistant';
import { SOUND_BASE64 } from '../services/soundBundle';

const { width: SW, height: SH } = Dimensions.get('window');

interface CoolPathAssistantModalProps {
  visible: boolean;
  onClose: () => void;
  currentOriginText: string;
  currentDestText: string;
  liveTempC: number | null;
  liveAqi: number | null;
  onPlanRouteAction: (originText: string, destText: string, activity?: string) => void;
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

function buildAudioEngineHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no"/>
  <style>
    body, html {
      margin: 0; padding: 0; width: 100%; height: 100%;
      overflow: hidden; background: transparent;
    }
    #canvas {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      z-index: 1; pointer-events: none;
    }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script>
  (function() {
    'use strict';

    function postRN(obj) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    }

    const soundSources = {
      intro: '${SOUND_BASE64.intro}',
      ready: '${SOUND_BASE64.ready}',
      start: '${SOUND_BASE64.start}',
      close: '${SOUND_BASE64.close}'
    };

    let audioCtx = null;
    const audioBuffers = {};

    function initAudioContext() {
      try {
        if (!audioCtx) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            audioCtx = new AudioContextClass();
          }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
      } catch(e) {}
    }

    function preloadAudioBuffers() {
      initAudioContext();
      if (!audioCtx) return;

      Object.keys(soundSources).forEach(function(key) {
        try {
          const dataUri = soundSources[key];
          fetch(dataUri)
            .then(function(res) { return res.arrayBuffer(); })
            .then(function(buf) {
              return audioCtx.decodeAudioData(buf);
            })
            .then(function(decoded) {
              audioBuffers[key] = decoded;
            })
            .catch(function(e) {});
        } catch(e) {}
      });
    }

    window._playEffect = function(name) {
      try {
        initAudioContext();
        if (audioCtx && audioBuffers[name]) {
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffers[name];
          source.connect(audioCtx.destination);
          source.onended = function() {
            postRN({ type: 'effect_ended', name: name });
          };
          source.start(0);
          return;
        }

        const src = soundSources[name];
        if (src) {
          const a = new Audio(src);
          a.volume = 1.0;
          a.onended = function() {
            postRN({ type: 'effect_ended', name: name });
          };
          a.play().catch(function(e) {
            postRN({ type: 'effect_ended', name: name });
          });
        }
      } catch(e) {}
    };

    let currentAudioSpeech = null;
    window._speakText = function(text) {
      window._stopListening();
      try {
        if (currentAudioSpeech) {
          try { currentAudioSpeech.pause(); } catch(e) {}
          currentAudioSpeech = null;
        }

        const url = "https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=" + encodeURIComponent(text);
        const a = new Audio(url);
        currentAudioSpeech = a;

        a.onended = function() {
          if (currentAudioSpeech === a) {
            currentAudioSpeech = null;
            postRN({ type: 'speech_ended' });
          }
        };

        a.onerror = function() {
          if (currentAudioSpeech === a) {
            currentAudioSpeech = null;
            postRN({ type: 'speech_ended' });
          }
        };

        a.play().catch(function(e) {
          if (currentAudioSpeech === a) {
            currentAudioSpeech = null;
            postRN({ type: 'speech_ended' });
          }
        });
      } catch(e) {
        postRN({ type: 'speech_ended' });
      }
    };

    // Dual-Engine Speech Recognition (WebSpeech + MediaRecorder Multimodal Fallback)
    let recognition = null;
    let isListening = false;
    let silenceTimer = null;
    let currentSpeech = '';
    let audioStream = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let analyser = null;
    let dataArray = null;
    let micVolume = 0;
    let hasSpoken = false;

    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = function() {
          postRN({ type: 'stt_started' });
        };

        recognition.onresult = function(event) {
          if (!isListening) return;

          let finalTokens = '';
          let interimTokens = '';

          for (let i = 0; i < event.results.length; ++i) {
            const res = event.results[i];
            if (res.isFinal) {
              finalTokens += res[0].transcript + ' ';
            } else {
              interimTokens += res[0].transcript;
            }
          }

          const combined = (finalTokens + ' ' + interimTokens).replace(/\s+/g, ' ').trim();
          if (combined) {
            currentSpeech = combined;
            hasSpoken = true;
            postRN({ type: 'stt_transcript_update', text: combined });

            if (silenceTimer) clearTimeout(silenceTimer);
            silenceTimer = setTimeout(function() {
              if (isListening && currentSpeech.trim().length >= 3) {
                window._stopListening();
              }
            }, 3000);
          }
        };

        recognition.onerror = function(event) {
          if (event.error === 'no-speech') return;
          postRN({ type: 'stt_error', error: 'Recognition error: ' + event.error });
        };

        recognition.onend = function() {
          if (!isListening) {
            postRN({ type: 'stt_ended' });
          }
        };
      }
    } catch(e) {}

    function runSimulatedVolume() {
      const checkVolSim = function() {
        if (!isListening) return;
        // Natural pulsing wave simulation
        micVolume = 12 + Math.sin(Date.now() * 0.008) * 8 + Math.cos(Date.now() * 0.003) * 4;
        requestAnimationFrame(checkVolSim);
      };
      checkVolSim();
    }

    window._startListening = function() {
      if (isListening) return;
      isListening = true;
      currentSpeech = '';
      audioChunks = [];
      micVolume = 0;
      hasSpoken = false;
      let silenceStart = null;
      const listenStartTime = Date.now();
      window._updateState('listening');

      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      initAudioContext();

      // Audio Mic Volume Tracking and Audio Recording
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function(stream) {
              audioStream = stream;
              if (audioCtx) {
                const source = audioCtx.createMediaStreamSource(stream);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 32;
                source.connect(analyser);
                const bufferLength = analyser.frequencyBinCount;
                dataArray = new Uint8Array(bufferLength);

                const checkVol = function() {
                  if (!isListening) return;
                  analyser.getByteFrequencyData(dataArray);
                  let sum = 0;
                  for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
                  micVolume = sum / bufferLength;

                  if (micVolume > 6.0) {
                    hasSpoken = true;
                  }

                  if (hasSpoken) {
                    if (micVolume < 3.5) {
                      if (!silenceStart) {
                        silenceStart = Date.now();
                      } else if (Date.now() - silenceStart > 2500) {
                        if (Date.now() - listenStartTime > 3000) {
                          window._stopListening();
                        }
                      }
                    } else {
                      silenceStart = null;
                    }
                  } else if (Date.now() - listenStartTime > 8000) {
                    window._stopListening();
                  }

                  requestAnimationFrame(checkVol);
                };
                checkVol();
              }

              // Start MediaRecorder if supported
              try {
                if (window.MediaRecorder) {
                  mediaRecorder = new MediaRecorder(stream);
                  mediaRecorder.ondataavailable = function(e) {
                    if (e.data && e.data.size > 0) {
                      audioChunks.push(e.data);
                    }
                  };
                  mediaRecorder.start(200);
                }
              } catch(mrErr) {}
            })
            .catch(function(err) {
              runSimulatedVolume();
            });
        } else {
          runSimulatedVolume();
        }
      } catch(e) {
        runSimulatedVolume();
      }

      if (recognition) {
        try { recognition.abort(); } catch(e) {}
        try { recognition.start(); } catch(e) {}
      }
    };

    window._stopListening = function() {
      if (!isListening) return;
      isListening = false;
      micVolume = 0;
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }

      const recordedText = currentSpeech.trim();
      currentSpeech = '';

      if (recordedText) {
        postRN({ type: 'stt_silence_detected', text: recordedText });
      } else if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try {
          mediaRecorder.onstop = function() {
            if (audioChunks.length > 0) {
              const mime = mediaRecorder.mimeType || 'audio/webm';
              const blob = new Blob(audioChunks, { type: mime });
              const reader = new FileReader();
              reader.onloadend = function() {
                postRN({
                  type: 'stt_audio_recorded',
                  audioBase64: reader.result,
                  mimeType: mime
                });
              };
              reader.readAsDataURL(blob);
            } else {
              postRN({ type: 'stt_ended' });
            }
          };
          mediaRecorder.stop();
        } catch(e) {
          postRN({ type: 'stt_ended' });
        }
      } else {
        postRN({ type: 'stt_ended' });
      }

      if (audioStream) {
        try {
          audioStream.getTracks().forEach(function(track) { track.stop(); });
        } catch(e) {}
        audioStream = null;
      }
      if (recognition) {
        try { recognition.stop(); } catch(e) {}
      }
    };

    window._stopAll = function() {
      isListening = false;
      micVolume = 0;
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch(e) {}
      }
      if (audioStream) {
        try {
          audioStream.getTracks().forEach(function(track) { track.stop(); });
        } catch(e) {}
        audioStream = null;
      }
      try {
        if (currentAudioSpeech) {
          try { currentAudioSpeech.pause(); } catch(e) {}
          currentAudioSpeech = null;
        }
        if (recognition) recognition.stop();
      } catch(e) {}
      window._updateState('idle');
    };

    // ── 🎨 WebGL/Canvas Waveform visualizer ──
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    let appState = 'idle'; // idle, listening, thinking, speaking
    let rotation = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.scale(dpr, dpr);
    }
    window.addEventListener('resize', resize);
    resize();

    window._updateState = function(newState) {
      appState = newState;
    };

    function draw() {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(5, 11, 20, 0.25)'; // Dark trailing background
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      rotation += 0.015;

      // Add a global lighter blend mode for glowing RGB
      ctx.globalCompositeOperation = 'lighter';

      if (appState === 'idle') {
        const r = 50 + Math.sin(Date.now() * 0.0035) * 4;
        const grad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
        grad.addColorStop(0, 'rgba(255, 0, 100, 0.85)');
        grad.addColorStop(0.4, 'rgba(0, 255, 100, 0.35)');
        grad.addColorStop(1, 'rgba(0, 100, 255, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI*2);
        ctx.fill();

      } else if (appState === 'listening') {
        const baseRadius = 60 + micVolume * 0.65;
        
        for (let i = 0; i < 3; i++) {
          const shift = i * Math.PI / 1.5 + rotation * (1 + i * 0.3);
          // Pure RGB glowing lines
          ctx.strokeStyle = i === 0 ? 'rgba(255, 50, 50, 0.8)' : i === 1 ? 'rgba(50, 255, 50, 0.8)' : 'rgba(50, 100, 255, 0.8)';
          ctx.lineWidth = 4.5;
          ctx.beginPath();
          for (let angle = 0; angle < Math.PI * 2; angle += 0.08) {
            const radNoise = Math.sin(angle * 5 + shift) * (12 + micVolume * 0.25);
            const r = baseRadius + radNoise;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (angle === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }

        const grad = ctx.createRadialGradient(cx, cy, baseRadius * 0.1, cx, cy, baseRadius * 0.6);
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.9)');
        grad.addColorStop(0.5, 'rgba(6, 182, 212, 0.5)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, baseRadius * 0.6, 0, Math.PI*2);
        ctx.fill();

      } else if (appState === 'thinking') {
        // Rotating purple cosmic portal
        const r = 65;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation * 1.5);
        
        const grad = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r * 1.0);
        grad.addColorStop(0, 'rgba(168, 85, 247, 0.9)');
        grad.addColorStop(0.5, 'rgba(99, 102, 241, 0.55)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI*2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(236, 72, 153, 0.6)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let angle = 0; angle < Math.PI * 2; angle += 0.05) {
          const rad = r * 0.85 + Math.cos(angle * 7 + rotation * 6) * 5;
          const x = Math.cos(angle) * rad;
          const y = Math.sin(angle) * rad;
          if (angle === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

      } else if (appState === 'speaking') {
        // Bouncing blue/indigo frequency waves
        const baseRadius = 66 + Math.sin(Date.now() * 0.015) * 9;
        
        for (let i = 0; i < 2; i++) {
          const shift = i * Math.PI + rotation * 3.0;
          ctx.strokeStyle = i === 0 ? 'rgba(56, 189, 248, 0.65)' : 'rgba(236, 72, 153, 0.5)';
          ctx.lineWidth = 4.0;
          ctx.beginPath();
          for (let angle = 0; angle < Math.PI * 2; angle += 0.08) {
            const radNoise = Math.sin(angle * 8 + shift) * 14;
            const r = baseRadius + radNoise;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (angle === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }

        const grad = ctx.createRadialGradient(cx, cy, baseRadius * 0.15, cx, cy, baseRadius * 0.7);
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.95)');
        grad.addColorStop(0.5, 'rgba(236, 72, 153, 0.5)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, baseRadius * 0.7, 0, Math.PI*2);
        ctx.fill();
      }

      requestAnimationFrame(draw);
    }

    setTimeout(preloadAudioBuffers, 100);
    requestAnimationFrame(draw);
    postRN({ type: 'audio_engine_ready' });
  })();
  </script>
</body>
</html>`;
}

const AUDIO_ENGINE_SOURCE = { html: buildAudioEngineHtml(), baseUrl: 'https://localhost' };

const ASSISTANT_CONTEXT_PHRASES = [
  'CoolPath',
  'cool route',
  'shaded route',
  'heat safe route',
  'city garden',
  'Central Park',
  'Times Square',
  'Brooklyn',
  'current location',
  'walking',
  'running',
  'biking',
  'driving',
];

function cleanSpokenText(text: string): string {
  return text.replace(/[*_~`#>-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeTranscript(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\bst\.?\s+garden\b/gi, 'city garden')
    .replace(/\bciti\s+garden\b/gi, 'city garden')
    .trim();
}

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
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [pendingAction, setPendingAction] = useState<any>(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [showTextBox, setShowTextBox] = useState(false);

  const audioEngineRef = useRef<WebView>(null);
  const isListeningRef = useRef(false);
  const isThinkingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const safetyTimerRef = useRef<NodeJS.Timeout | null>(null);
  const listenTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasSpokenGreeting = useRef(false);
  const hasStartedListeningAfterGreeting = useRef(false);
  const latestTranscriptRef = useRef('');
  const isSubmittingSpeechRef = useRef(false);
  const suppressRecognitionEventsRef = useRef(false);
  const activeSessionRef = useRef(0);
  const speechFinishCallbackRef = useRef<(() => void) | null>(null);

  const scrollViewRef = useRef<ScrollView>(null);
  const micWaveAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isListening) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(micWaveAnim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(micWaveAnim, { toValue: -1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(micWaveAnim, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      micWaveAnim.stopAnimation();
      Animated.timing(micWaveAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    }
  }, [isListening]);

  useEffect(() => {
    const speechRecognitionEvents = ExpoSpeechRecognitionModule as any;
    const subscriptions = [
      speechRecognitionEvents.addListener('start', () => {
        if (!suppressRecognitionEventsRef.current && isListeningRef.current) {
          setIsListening(true);
          updateEngineState('listening');
        }
      }),
      speechRecognitionEvents.addListener('result', (event: any) => {
        if (suppressRecognitionEventsRef.current || !isListeningRef.current) return;

        const rawTranscript = event.results?.[0]?.transcript || '';
        const bestTranscript = normalizeTranscript(rawTranscript);

        if (!bestTranscript) return;
        latestTranscriptRef.current = bestTranscript;
        setLiveTranscript(bestTranscript);

        if (event.isFinal && bestTranscript.length >= 2 && !isSubmittingSpeechRef.current) {
          isSubmittingSpeechRef.current = true;
          handleSendPrompt(bestTranscript);
        }
      }),
      speechRecognitionEvents.addListener('end', () => {
        if (suppressRecognitionEventsRef.current) return;
        const fallbackTranscript = latestTranscriptRef.current.trim();
        if (isListeningRef.current && fallbackTranscript && !isSubmittingSpeechRef.current) {
          isSubmittingSpeechRef.current = true;
          handleSendPrompt(fallbackTranscript);
          return;
        }
        isListeningRef.current = false;
        setIsListening(false);
        if (!isThinkingRef.current && !isSpeakingRef.current) {
          updateEngineState('idle');
        }
      }),
      speechRecognitionEvents.addListener('error', (event: any) => {
        if (suppressRecognitionEventsRef.current || event.error === 'aborted') return;
        
        // Suppress expected silence timeouts from cluttering the console
        if (event.error !== 'no-speech') {
          console.warn('[VoiceAssistant STT Error]', event.error, event.message);
        }
        
        isListeningRef.current = false;
        setIsListening(false);
        if (!isThinkingRef.current && !isSpeakingRef.current) {
          updateEngineState('idle');
        }

        if (event.error === 'no-speech' || event.error === 'audio-capture') {
          const errMsg: AssistantChatMessage = {
            role: 'assistant',
            content: "I didn't quite catch that. Could you please repeat?",
            display_text:
              "⚠️ **No speech detected**\n\nI couldn't hear you clearly. Please try again or tap the keyboard icon to type.",
            suggested_replies: ['Plan route to Central Park', 'Check weather'],
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, errMsg]);
          speakText("I didn't quite catch that. Could you please repeat?");
        }
      }),
    ];

    return () => {
      subscriptions.forEach((subscription) => subscription?.remove?.());
    };
  }, []);

  const updateEngineState = (state: 'idle' | 'listening' | 'thinking' | 'speaking') => {
    audioEngineRef.current?.injectJavaScript(`window._updateState && window._updateState('${state}'); true;`);
  };

  const playAudio = (effect: 'intro' | 'ready' | 'start' | 'close') => {
    audioEngineRef.current?.injectJavaScript(`window._playEffect && window._playEffect('${effect}'); true;`);
  };

  const clearListenTimer = () => {
    if (listenTimerRef.current) {
      clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }
  };

  const buildSpeechContext = () => {
    return Array.from(
      new Set(
        [
          ...ASSISTANT_CONTEXT_PHRASES,
          currentOriginText,
          currentDestText,
          pendingAction?.origin,
          pendingAction?.destination,
        ]
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 1)
          .map((item) => item.trim())
      )
    );
  };

  const speakGreetingOnce = () => {
    if (hasSpokenGreeting.current) return;
    hasSpokenGreeting.current = true;
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
    speakText("Hi! I'm CoolPath Assistant. Where would you like to go today?");
  };

  const speakText = (text: string, onFinish?: () => void) => {
    stopListening({ suppressRecognitionEvents: true, preserveEngineState: true });
    if (isMuted || !text) {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      if (!isThinkingRef.current) {
        updateEngineState('idle');
      }
      onFinish?.();
      return;
    }
    isSpeakingRef.current = true;
    setIsSpeaking(true);
    updateEngineState('speaking');
    const cleanSpoken = cleanSpokenText(text);

    speechFinishCallbackRef.current = onFinish || null;
    audioEngineRef.current?.injectJavaScript(`window._speakText && window._speakText(${JSON.stringify(cleanSpoken)}); true;`);
  };

  const startListening = async () => {
    if (isThinkingRef.current || isSpeakingRef.current) return;
    if (isListeningRef.current) return;

    suppressRecognitionEventsRef.current = false;
    isSubmittingSpeechRef.current = false;
    latestTranscriptRef.current = '';
    isListeningRef.current = true;
    setIsListening(true);
    setLiveTranscript('');
    playAudio('ready');
    updateEngineState('listening');

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
        isListeningRef.current = false;
        setIsListening(false);
        updateEngineState('idle');
        const errMsg: AssistantChatMessage = {
          role: 'assistant',
          content: 'Microphone permission is required for voice commands.',
          display_text:
            '🎙️ **Microphone permission needed**\n\nPlease allow microphone and speech recognition access, or use Keyboard Mode.',
          suggested_replies: ['Keyboard Mode', 'Plan route to Central Park'],
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errMsg]);
        return;
      }

      let googleServicePackage: string | undefined = undefined;
      if (Platform.OS === 'android') {
        try {
          const services = ExpoSpeechRecognitionModule.getSpeechRecognitionServices();
          googleServicePackage =
            services.find((s: string) => s.includes('googlequicksearchbox')) ||
            services.find((s: string) => s.includes('com.google.android.as')) ||
            services.find((s: string) => s.includes('google'));
        } catch (e) {}
      }

      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        contextualStrings: buildSpeechContext(),
        addsPunctuation: true,
        androidRecognitionServicePackage: googleServicePackage,
        androidIntentOptions: {
          EXTRA_LANGUAGE_MODEL: 'free_form',
          EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 2500,
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1800,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 1200,
        },
        iosTaskHint: 'dictation',
      });

      clearListenTimer();
      listenTimerRef.current = setTimeout(() => {
        const transcript = latestTranscriptRef.current.trim();
        if (isListeningRef.current && transcript && !isSubmittingSpeechRef.current) {
          isSubmittingSpeechRef.current = true;
          handleSendPrompt(transcript);
        } else if (isListeningRef.current) {
          stopListening();
        }
      }, 14000);
    } catch (err) {
      console.warn('[VoiceAssistant STT Start Error]', err);
      isListeningRef.current = false;
      setIsListening(false);
      updateEngineState('idle');
    }
  };

  const stopListening = (options?: { suppressRecognitionEvents?: boolean; preserveEngineState?: boolean }) => {
    clearListenTimer();
    if (options?.suppressRecognitionEvents) {
      suppressRecognitionEventsRef.current = true;
    }
    isListeningRef.current = false;
    setIsListening(false);
    if (!options?.preserveEngineState && !isThinkingRef.current && !isSpeakingRef.current) {
      updateEngineState('idle');
    }
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (e) {}
    audioEngineRef.current?.injectJavaScript('window._stopListening && window._stopListening(); true;');
  };

  const stopAll = () => {
    activeSessionRef.current += 1;
    suppressRecognitionEventsRef.current = true;
    clearListenTimer();
    isListeningRef.current = false;
    isSpeakingRef.current = false;
    isThinkingRef.current = false;
    setIsListening(false);
    setIsSpeaking(false);
    setIsThinking(false);
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
    speechFinishCallbackRef.current = null;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch (e) {}
    audioEngineRef.current?.injectJavaScript('window._stopAll && window._stopAll(); true;');
  };


  // Initial greeting welcome sequence
  useEffect(() => {
    if (visible) {
      activeSessionRef.current += 1;
      suppressRecognitionEventsRef.current = false;
      hasSpokenGreeting.current = false;
      hasStartedListeningAfterGreeting.current = false;

      const initialGreeting: AssistantChatMessage = {
        role: 'assistant',
        content: "Hi! I'm CoolPath Assistant. Tell me where you'd like to go, or ask for a shaded route!",
        display_text:
          "👋 **Hi! I'm CoolPath Assistant.**\n\nI specialize in heat-safe urban navigation, finding shaded corridors, and protecting you from asphalt heatwaves.\n\nWhere would you like to travel?",
        suggested_replies: ['Plan route to Central Park', 'Times Square to Brooklyn', 'Check current weather'],
        timestamp: Date.now(),
      };
      setMessages([initialGreeting]);

      const startSequence = () => {
        playAudio('intro');
        // Fallback only if the WebView never sends the sound completion event.
        safetyTimerRef.current = setTimeout(() => {
          speakGreetingOnce();
        }, 7000);
      };

      const timer = setTimeout(startSequence, 250);
      return () => {
        clearTimeout(timer);
        if (safetyTimerRef.current) {
          clearTimeout(safetyTimerRef.current);
          safetyTimerRef.current = null;
        }
        stopAll();
      };
    } else {
      stopAll();
    }
  }, [visible]);

  const handleClose = () => {
    stopAll();
    playAudio('close');
    onClose();
  };

  const handleSendPrompt = async (textToSend: string) => {
    if (!textToSend || !textToSend.trim() || isThinkingRef.current) return;

    const requestSession = activeSessionRef.current;
    const userText = normalizeTranscript(textToSend);
    setInputText('');
    setLiveTranscript('');
    stopListening({ suppressRecognitionEvents: true, preserveEngineState: true });

    const newMsgList: AssistantChatMessage[] = [
      ...messages,
      { role: 'user', content: userText, timestamp: Date.now() },
    ];
    setMessages(newMsgList);

    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);

    playAudio('start');
    isThinkingRef.current = true;
    setIsThinking(true);
    updateEngineState('thinking');

    const context: AssistantChatContext = {
      current_origin: currentOriginText,
      current_dest: currentDestText,
      temp_c: liveTempC ?? 30,
      aqi: liveAqi ?? 45,
      pending_action: pendingAction,
    };

    try {
      const response = await callAssistantBackend(
        newMsgList.map((m) => ({ role: m.role, content: m.content })),
        context
      );

      if (requestSession !== activeSessionRef.current) return;

      isThinkingRef.current = false;
      setIsThinking(false);
      isSubmittingSpeechRef.current = false;

      const assistantMsg: AssistantChatMessage = {
        role: 'assistant',
        content: response.spoken_response,
        display_text: response.display_text,
        action: response.action,
        action_data: response.action_data,
        suggested_replies: response.suggested_replies || [],
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);

      let routeActionToExecute: any = null;

      // Keep action plan persistent and display card for user confirmation
      if (response.action_data || response.action === 'confirm_route' || response.action === 'execute_route') {
        const actionData = response.action_data || {
          origin: currentOriginText,
          destination: currentDestText,
          activity: 'walking',
        };
        
        if (response.action === 'execute_route') {
          routeActionToExecute = actionData;
        } else {
          setPendingAction(actionData);
        }
      }

      speakText(response.spoken_response, () => {
        if (routeActionToExecute && requestSession === activeSessionRef.current) {
          handleExecuteConfirmedRoute(routeActionToExecute);
        }
      });
    } catch (err) {
      if (requestSession !== activeSessionRef.current) return;
      isThinkingRef.current = false;
      setIsThinking(false);
      isSubmittingSpeechRef.current = false;
      updateEngineState('idle');
      const errMsg: AssistantChatMessage = {
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again.",
        display_text: "⚠️ **Connection Error**\n\nCould not reach CoolPath Assistant. Please check connection and try again.",
        suggested_replies: ['Try again', 'Check weather'],
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    }
  };

  const handleMicButtonPress = () => {
    if (isSpeaking) {
      stopAll();
      return;
    }
    if (isListening) {
      if (liveTranscript.trim()) {
        handleSendPrompt(liveTranscript);
      } else {
        stopListening();
      }
    } else {
      startListening();
    }
  };

  const handleExecuteConfirmedRoute = (actionData: any) => {
    const orig = actionData?.origin || currentOriginText;
    const dest = actionData?.destination || currentDestText;
    const act = actionData?.activity || 'walking';
    setPendingAction(null);
    stopAll();
    playAudio('start');
    onPlanRouteAction(orig, dest, act);
    onClose();
  };

  // Keep last message only for minimalist live UI feel
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

  const activeAction = (lastMsg?.action_data || pendingAction) as
    | { origin?: string; destination?: string; activity?: string }
    | null;

  const getActivityMeta = (activity?: string) => {
    const a = (activity || 'walking').toLowerCase();
    if (a.includes('run')) return { icon: 'running' as const, label: 'Running' };
    if (a.includes('bik') || a.includes('cycl')) return { icon: 'bicycle' as const, label: 'Biking' };
    if (a.includes('driv') || a.includes('car')) return { icon: 'car' as const, label: 'Driving' };
    return { icon: 'walking' as const, label: 'Walking' };
  };

  const activityMeta = getActivityMeta(activeAction?.activity);

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={handleClose}>
      <View style={styles.container}>
        {/* WebView Core Audio Engine */}
        <WebView
          ref={audioEngineRef}
          originWhitelist={['*']}
          source={AUDIO_ENGINE_SOURCE}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback={true}
          style={StyleSheet.absoluteFill}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data.type === 'effect_ended') {
                if (data.name === 'intro') {
                  speakGreetingOnce();
                }
              } else if (data.type === 'speech_ended') {
                const onSpeechFinish = speechFinishCallbackRef.current;
                speechFinishCallbackRef.current = null;
                isSpeakingRef.current = false;
                setIsSpeaking(false);
                if (!isThinkingRef.current) {
                  updateEngineState('idle');
                }
                onSpeechFinish?.();
                if (hasSpokenGreeting.current && !hasStartedListeningAfterGreeting.current) {
                  hasStartedListeningAfterGreeting.current = true;
                  startListening();
                } else if (
                  messages.length > 0 && 
                  messages[messages.length - 1].action === 'confirm_route'
                ) {
                  // Automatically start listening so the user can answer "Yes" or "No"
                  startListening();
                }
              } else if (data.type === 'stt_transcript_update') {
                if (isListeningRef.current) {
                  setLiveTranscript(data.text);
                }
              } else if (data.type === 'stt_silence_detected') {
                if (isListeningRef.current && data.text && data.text.trim()) {
                  handleSendPrompt(data.text.trim());
                }
              } else if (data.type === 'stt_audio_recorded') {
                if (data.audioBase64) {
                  setLiveTranscript("🎙️ Analyzing speech...");
                  isThinkingRef.current = true;
                  setIsThinking(true);
                  updateEngineState('thinking');
                  transcribeAudio(data.audioBase64, data.mimeType)
                    .then((transcript) => {
                      if (transcript && transcript.trim()) {
                        handleSendPrompt(transcript.trim());
                      } else {
                        isThinkingRef.current = false;
                        isSubmittingSpeechRef.current = false;
                        setIsThinking(false);
                        updateEngineState('idle');
                        setLiveTranscript("");
                        const errMsg: AssistantChatMessage = {
                          role: 'assistant',
                          content: "I didn't quite catch that. Could you please repeat?",
                          display_text: "⚠️ **No speech detected**\n\nI couldn't hear you clearly. Please try again or tap the keyboard icon to type.",
                          suggested_replies: ['Plan route to Central Park', 'Check weather'],
                          timestamp: Date.now(),
                        };
                        setMessages((prev) => [...prev, errMsg]);
                        speakText("I didn't quite catch that. Could you please repeat?");
                      }
                    })
                    .catch(() => {
                      isThinkingRef.current = false;
                      isSubmittingSpeechRef.current = false;
                      setIsThinking(false);
                      updateEngineState('idle');
                      setLiveTranscript("");
                      const errMsg: AssistantChatMessage = {
                        role: 'assistant',
                        content: "I didn't quite catch that. Could you please repeat?",
                        display_text: "⚠️ **No speech detected**\n\nI couldn't hear you clearly. Please try again or tap the keyboard icon to type.",
                        suggested_replies: ['Plan route to Central Park', 'Check weather'],
                        timestamp: Date.now(),
                      };
                      setMessages((prev) => [...prev, errMsg]);
                      speakText("I didn't quite catch that. Could you please repeat?");
                    });
                }
              } else if (data.type === 'stt_ended') {
                isListeningRef.current = false;
                setIsListening(false);
                if (!isThinkingRef.current && !isSpeakingRef.current) {
                  updateEngineState('idle');
                }
              } else if (data.type === 'stt_error') {
                console.warn("[VoiceAssistant STT Error]", data.error);
              } else if (data.type === 'stt_not_supported') {
                console.warn("[VoiceAssistant] WebSpeech not supported, falling back to MediaRecorder");
              }
            } catch (e) {}
          }}
          {...({
            onPermissionRequest: (request: any) => {
              request.grant();
            }
          } as any)}
        />

        {/* ── Immersive Glass Header Bar ── */}
        <View style={styles.headerGlass}>
          <View style={styles.headerBadge}>
            <View style={styles.badgePulseGreen} />
            <Text style={styles.badgeTxt}>LIVE SESSION</Text>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.iconCircle}
              onPress={() => {
                if (!isMuted) stopAll();
                setIsMuted((m) => !m);
              }}
            >
              <Ionicons
                name={isMuted ? 'volume-mute' : 'volume-high'}
                size={18}
                color={isMuted ? '#EF4444' : '#10B981'}
              />
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconCircle} onPress={handleClose}>
              <Ionicons name="close" size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Fluid Messaging Overlay (Top half of screen) ── */}
        <View style={styles.conversationLayer}>
          {lastMsg && (
            <ScrollView 
              contentContainerStyle={{ justifyContent: 'flex-end', flexGrow: 1 }}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <Animated.View style={styles.messageBubbleAnimated}>
                {lastMsg.role === 'assistant' ? (
                  <View style={styles.assistantSpeechRow}>
                    <View style={styles.assistantSpark}>
                      <Ionicons name="sparkles" size={10} color="#10B981" />
                    </View>
                    <Text style={styles.assistantSpeechTxt}>
                      {lastMsg.display_text || lastMsg.content}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.userSpeechRow}>
                    <Text style={styles.userSpeechTxt}>{lastMsg.content}</Text>
                  </View>
                )}

                {/* Action plan confirmation card */}
                {Boolean(lastMsg.action_data || pendingAction) && (
                  <View style={styles.floatingActionCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                      <FontAwesome5 name="route" size={13} color="#10B981" style={{ marginRight: 8 }} />
                      <Text style={styles.actionCardTitle}>Heat-Safe Route Prepared</Text>
                    </View>
                    <Text style={styles.actionCardBody}>
                      From: <Text style={{ color: '#fff', fontWeight: '800' }}>{(lastMsg.action_data || pendingAction)?.origin || currentOriginText || 'Start Point'}</Text>
                      {'\n'}To: <Text style={{ color: '#fff', fontWeight: '800' }}>{(lastMsg.action_data || pendingAction)?.destination || currentDestText || 'Destination'}</Text>
                      {(lastMsg.action_data || pendingAction)?.activity ? `\nMode: ${((lastMsg.action_data || pendingAction)?.activity).toUpperCase()}` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                      <TouchableOpacity
                        style={styles.actionCardConfirmBtn}
                        onPress={() => handleExecuteConfirmedRoute(lastMsg.action_data || pendingAction)}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="navigate" size={15} color="#ffffff" style={{ marginRight: 4 }} />
                        <Text style={styles.actionCardConfirmTxt}>Navigate Cool Route</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actionCardCancelBtn}
                        onPress={() => setPendingAction(null)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.actionCardCancelTxt}>Dismiss</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </Animated.View>
            </ScrollView>
          )}

          {isThinking && (
            <View style={styles.thinkingBoxGlass}>
              <ActivityIndicator size="small" color="#10B981" style={{ marginRight: 8 }} />
              <Text style={styles.thinkingTxt}>CoolPath Assistant is planning...</Text>
            </View>
          )}
        </View>

        {/* ── Subtitle and Mic Control Section (Bottom half of screen) ── */}
        <View style={styles.controlsLayer} pointerEvents="box-none">
          {/* Live Subtitle bar reacting dynamically to real speech */}
          {isListening && (
            <View style={styles.liveSubtitlePill}>
              <View style={styles.redDotRecording} />
              <Text style={styles.liveSubtitleTxt}>
                {liveTranscript || 'Listening... Speak destination'}
              </Text>
            </View>
          )}

          {/* Glowing Animated Voice Orb Tap Launcher */}
          <TouchableOpacity
            style={[
              styles.micOrbButton,
              isListening && styles.micOrbListening,
              isThinking && styles.micOrbThinking,
              isSpeaking && styles.micOrbSpeaking,
            ]}
            onPress={handleMicButtonPress}
            activeOpacity={0.9}
          >
            <Animated.Image
              source={require('../../assets/assistant.png')}
              style={{
                width: 44,
                height: 44,
                tintColor: isSpeaking ? '#ffffff' : undefined,
                transform: [
                  {
                    rotate: micWaveAnim.interpolate({
                      inputRange: [-1, 1],
                      outputRange: ['-15deg', '15deg'],
                    }),
                  },
                  {
                    scale: micWaveAnim.interpolate({
                      inputRange: [-1, 0, 1],
                      outputRange: [0.9, 1, 0.9],
                    }),
                  },
                ],
              }}
              resizeMode="contain"
            />
          </TouchableOpacity>

          <Text style={styles.micStateLabel}>
            {isListening
              ? 'LIVE VOICE ACTIVE'
              : isSpeaking
              ? 'TAP ORB TO PAUSE VOICE'
              : isThinking
              ? 'PLANNING CORRIDORS'
              : 'TAP ORB TO SPEAK'}
          </Text>

          {/* Quick reply presets bar */}
          {lastMsg && lastMsg.suggested_replies && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.suggestedScroll}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
            >
              {lastMsg.suggested_replies.map((reply, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.suggestedChip}
                  onPress={() => handleSendPrompt(reply)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.suggestedChipTxt}>{reply}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Elegant Text Keyboard Toggle */}
          <View style={styles.keyboardToggleBar}>
            {showTextBox ? (
              <View style={styles.keyboardInputRow}>
                <TextInput
                  style={styles.keyboardTextInput}
                  placeholder="Or type prompt here..."
                  placeholderTextColor="#64748b"
                  value={inputText}
                  onChangeText={setInputText}
                  onSubmitEditing={() => {
                    handleSendPrompt(inputText);
                    setShowTextBox(false);
                  }}
                  returnKeyType="send"
                />
                <TouchableOpacity
                  style={styles.keyboardSendBtn}
                  onPress={() => {
                    handleSendPrompt(inputText);
                    setShowTextBox(false);
                  }}
                >
                  <Ionicons name="arrow-up" size={18} color="#ffffff" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.keyboardPillBtn}
                onPress={() => setShowTextBox(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="chatbox-ellipses-outline" size={14} color="#94a3b8" style={{ marginRight: 6 }} />
                <Text style={styles.keyboardPillTxt}>Keyboard Mode</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617', // Immersive cosmic dark theme
  },
  hiddenAudioBridge: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
  },
  headerGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'ios' ? 52 : 24,
    paddingBottom: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    zIndex: 10,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  badgePulseGreen: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  badgeTxt: {
    color: '#10B981',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  conversationLayer: {
    flex: 1.1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 10,
    zIndex: 5,
  },
  messageBubbleAnimated: {
    width: '100%',
  },
  assistantSpeechRow: {
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  assistantSpark: {
    position: 'absolute',
    left: -6,
    top: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantSpeechTxt: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
  userSpeechRow: {
    alignSelf: 'flex-end',
    backgroundColor: '#10B981',
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: '85%',
  },
  userSpeechTxt: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  thinkingBoxGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  thinkingTxt: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  floatingActionCard: {
    marginTop: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1.5,
    borderColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  actionCardTitle: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '800',
  },
  actionCardBody: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  actionCardConfirmBtn: {
    flex: 1.3,
    backgroundColor: '#10B981',
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCardConfirmTxt: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  actionCardCancelBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  actionCardCancelTxt: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  controlsLayer: {
    flex: 1.2,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: Platform.OS === 'ios' ? 44 : 24,
    zIndex: 8,
  },
  liveSubtitlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    maxWidth: '85%',
    marginBottom: 20,
  },
  redDotRecording: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
    marginRight: 8,
  },
  liveSubtitleTxt: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  micOrbButton: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  micOrbListening: {
    backgroundColor: '#10B981',
    borderColor: '#34d399',
  },
  micOrbThinking: {
    backgroundColor: '#A855F7',
    borderColor: '#c084fc',
  },
  micOrbSpeaking: {
    backgroundColor: '#38BDF8',
    borderColor: '#7dd3fc',
  },
  micStateLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.0,
    marginTop: 10,
    marginBottom: 20,
  },
  suggestedScroll: {
    maxHeight: 34,
    width: SW,
    marginBottom: 16,
  },
  suggestedChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestedChipTxt: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  keyboardToggleBar: {
    width: '100%',
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  keyboardPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  keyboardPillTxt: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  keyboardInputRow: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'center',
    gap: 8,
  },
  keyboardTextInput: {
    flex: 1,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    color: '#ffffff',
    paddingHorizontal: 16,
    fontSize: 13,
  },
  keyboardSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
