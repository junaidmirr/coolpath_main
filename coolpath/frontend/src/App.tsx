import { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock3, Database, MapPin, Navigation, ShieldCheck, ThermometerSun } from 'lucide-react';
import Map, { type PinMode } from './components/Map';
import LocationSearch, { type GeoResult } from './components/LocationSearch';
import { planMission, checkBackendHealth, parseUserIntent, type BackendStatus } from './services/api';
import type { MissionRequest, MissionResponse, ActivityType, PaceType, PlanningMode, ParsedIntent } from './types/mission';
import './index.css';


interface NamedCoord {
  lat: number;
  lng: number;
  name: string;
}

const ACTIVITIES: { id: ActivityType; label: string; icon: string; speedKmh: number }[] = [
  { id: 'walking', label: 'Walk', icon: '🚶', speedKmh: 5.0 },
  { id: 'running', label: 'Run', icon: '🏃', speedKmh: 10.0 },
  { id: 'biking', label: 'Bike', icon: '🚴', speedKmh: 16.0 },
  { id: 'driving', label: 'Drive', icon: '🚗', speedKmh: 35.0 },
];

const PACES: { id: PaceType; label: string }[] = [
  { id: 'slow', label: 'Relaxed' },
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Fast' },
];

const AGENT_PRESETS = [
  { label: '🐕 Dog Walk in Shade', prompt: "I'm walking my dog in Lower Manhattan to the vet, dog's paws burn easily on hot asphalt" },
  { label: '🏃 Coolest 5k Run Path', prompt: "Running 5km in Lower Manhattan, want coolest shade path and hyperthermia prevention" },
  { label: '🚴 Relaxed Bike Trip', prompt: "Relaxed bike ride from Financial District to Lower East Side, avoid high heat avenues" },
];

function App() {
  const [loading, setLoading] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState('');
  const [specialTags, setSpecialTags] = useState<string[]>([]);
  const [response, setResponse] = useState<MissionResponse | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string>('coolest');
  const [error, setError] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({ online: false, url: null, port: null });

  // Planning Mode: Instant vs Scheduled
  const [planningMode, setPlanningMode] = useState<PlanningMode>('instant');
  const [deadlineMinutes, setDeadlineMinutes] = useState<number>(45);

  // Lower Manhattan defaults
  const [origin, setOrigin] = useState<NamedCoord>({ lat: 40.7080, lng: -74.0120, name: 'Lower Manhattan, New York' });
  const [dest, setDest] = useState<NamedCoord>({ lat: 40.7140, lng: -74.0060, name: 'Financial District, New York' });
  
  // Activity and Pace
  const [activity, setActivity] = useState<ActivityType>('walking');
  const [pace, setPace] = useState<PaceType>('normal');

  // Map pin mode
  const [pinMode, setPinMode] = useState<PinMode>(null);

  // Calculate distance
  const distanceKm = useMemo(() => {
    const R = 6371;
    const dLat = (dest.lat - origin.lat) * (Math.PI / 180);
    const dLon = (dest.lng - origin.lng) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(origin.lat * (Math.PI / 180)) *
        Math.cos(dest.lat * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, [origin, dest]);

  const currentActivityConfig = useMemo(() => {
    return ACTIVITIES.find((a) => a.id === activity) || ACTIVITIES[0];
  }, [activity]);

  const estimatedMinutes = useMemo(() => {
    const paceMult = pace === 'slow' ? 1.25 : pace === 'fast' ? 0.8 : 1.0;
    return Math.max(1, Math.round((distanceKm / currentActivityConfig.speedKmh) * 60 * paceMult));
  }, [distanceKm, currentActivityConfig, pace]);

  // Health check
  useEffect(() => {
    let cancelled = false;
    const update = async () => {
      const status = await checkBackendHealth();
      if (!cancelled) setBackendStatus(status);
    };
    update();
    const interval = setInterval(update, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Gemini Intent Agent Parsing
  const handleParsePrompt = async (promptToParse: string) => {
    if (!promptToParse.trim()) return;
    setAgentLoading(true);
    setError(null);
    try {
      const res = await parseUserIntent(promptToParse);
      const intent: ParsedIntent = res.intent;
      if (intent) {
        if (intent.activity) setActivity(intent.activity);
        if (intent.pace) setPace(intent.pace);
        if (intent.special_profile_tags) setSpecialTags(intent.special_profile_tags);
        if (intent.deadline_minutes) {
          setPlanningMode('scheduled');
          setDeadlineMinutes(intent.deadline_minutes);
        }
      }
    } catch (err: any) {
      console.warn('Agent intent parsing warning:', err);
    } finally {
      setAgentLoading(false);
    }
  };

  const handleOriginSelect = (r: GeoResult) => {
    setOrigin({ lat: r.lat, lng: r.lng, name: r.display_name });
    setResponse(null);
    setError(null);
  };

  const handleDestSelect = (r: GeoResult) => {
    setDest({ lat: r.lat, lng: r.lng, name: r.display_name });
    setResponse(null);
    setError(null);
  };

  const handleMapClick = useCallback((lat: number, lng: number) => {
    const shortName = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (pinMode === 'origin') {
      setOrigin({ lat, lng, name: shortName });
    } else if (pinMode === 'destination') {
      setDest({ lat, lng, name: shortName });
    }
    setPinMode(null);
    setResponse(null);
    setError(null);
  }, [pinMode]);

  const handlePlan = async () => {
    if (!backendStatus.online) {
      setError('Backend is offline. Start it with ./start.sh.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const request: MissionRequest = {
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: dest.lat, lng: dest.lng },
        planning_mode: planningMode,
        deadline_minutes: planningMode === 'scheduled' ? deadlineMinutes : estimatedMinutes + 15,
        activity,
        pace,
        prompt: agentPrompt || undefined,
        special_tags: specialTags
      };


      const result = await planMission(request);
      setResponse(result);

      if (result.route_options && result.route_options.length > 0) {
        const rec = result.route_options.find((r) => r.is_recommended) || result.route_options[0];
        setSelectedRouteId(rec.id);
      } else {
        setSelectedRouteId('recommended');
      }
    } catch (err: any) {
      const msg =
        err.response?.data?.detail?.message ||
        err.response?.data?.detail ||
        err.message ||
        'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const decisionColor: Record<string, string> = {
    DISPATCH_NOW: '#15803d',
    DELAY: '#b45309',
    REROUTE: '#2563eb',
    ESCALATE: '#b91c1c',
    GO: '#10b981',
    WAIT: '#f59e0b',
    WAIT_AND_REROUTE: '#8b5cf6',
    'HIGH HEAT — BEST AVAILABLE PLAN': '#ef4444',
    'NO ROUTE': '#6b7280',
  };

  const decisionMeta: Record<string, { title: string; status: string; icon: typeof CheckCircle2 }> = {
    DISPATCH_NOW: { title: 'Dispatch now', status: 'Configured policy satisfied', icon: CheckCircle2 },
    DELAY: { title: `Hold for ${response?.wait_minutes || 0} minutes`, status: 'Lower calculated environmental exposure', icon: Clock3 },
    REROUTE: { title: 'Use the alternate route', status: 'Lower calculated environmental exposure', icon: Navigation },
    ESCALATE: { title: 'Supervisor review required', status: 'Configured policy conflict', icon: AlertTriangle },
  };

  const reasonLabels: Record<string, string> = {
    NO_FEASIBLE_CANDIDATE: 'No feasible candidate',
    NO_POLICY_COMPLIANT_PLAN: 'No policy-compliant plan',
    THERMAL_POLICY_CONFLICT: 'Thermal policy conflict',
    SUPERVISOR_APPROVAL_REQUIRED: 'Supervisor approval required',
    LOWER_CALCULATED_EXPOSURE: 'Lower calculated exposure',
    SLA_MET: 'SLA met',
    SLA_VIOLATION: 'SLA violation',
    EMERGENCY_PRIORITY: 'Emergency priority',
  };

  const currentDecision = response ? decisionMeta[response.decision] || {
    title: response.decision.replace(/_/g, ' '),
    status: 'Evaluation complete',
    icon: Activity,
  } : null;

  const activityVerb = useMemo(() => {
    switch (activity) {
      case 'running': return 'Run';
      case 'biking': return 'Ride';
      case 'driving': return 'Drive';
      default: return 'Walk';
    }
  }, [activity]);

  const activeRoute = useMemo(() => {
    if (!response?.route_options || response.route_options.length === 0) return null;
    return response.route_options.find((r) => r.id === selectedRouteId) || response.route_options[0];
  }, [response, selectedRouteId]);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><ThermometerSun size={21} strokeWidth={2.4} /></div>
          <div>
            <div className="brand-name">CoolPath Ops</div>
            <div className="brand-subtitle">Thermal Dispatch Gate</div>
          </div>
        </div>
        <div className="topbar-context">
          <span className="context-kicker">Operational console</span>
          <span>Heat-to-dispatch translation for field crews</span>
        </div>
        <div className="system-status" aria-live="polite">
          <span className={`status-dot ${backendStatus.online ? 'status-dot--online' : ''}`} />
          <span>{backendStatus.online ? 'System online' : 'Waking backend'}</span>
          <span className="status-divider" />
          <span className="status-muted">{backendStatus.online ? 'Ready for evaluation' : 'Connecting...'}</span>
        </div>
      </header>
      <main className="console-layout">
      <div className="sidebar">
        {/* Header */}
        <div className="header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <h1 style={{ margin: 0 }}>CoolPath</h1>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              fontSize: '11px', fontWeight: 600, padding: '4px 8px', borderRadius: '12px',
              background: backendStatus.online ? '#ecfdf5' : '#fef2f2',
              color: backendStatus.online ? '#065f46' : '#991b1b',
              border: `1px solid ${backendStatus.online ? '#a7f3d0' : '#fecaca'}`
            }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: backendStatus.online ? '#10b981' : '#ef4444' }} />
              {backendStatus.online ? `Port ${backendStatus.port}` : 'Backend Offline'}
            </span>
          </div>
          <p>Heat-aware multi-modal mission planner — powered by FortyGuard & CoolPath Assistant.</p>
        </div>

        {/* Form */}
        <div className="form-section">
          {/* ✨ CoolPath Assistant Natural Language Prompt Bar */}
          <div style={{
            marginBottom: '16px',
            padding: '12px 14px',
            background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
            border: '1px solid #bae6fd',
            borderRadius: '10px',
            boxShadow: '0 2px 6px rgba(56, 189, 248, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#0369a1', display: 'flex', alignItems: 'center', gap: '5px' }}>
                ✨ CoolPath Assistant Prompt Bar
              </span>
              {agentLoading && <span style={{ fontSize: '11px', color: '#0284c7' }}>⏳ CoolPath parsing…</span>}
            </div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              <input
                type="text"
                value={agentPrompt}
                placeholder="e.g. Walking my dog to East Village, paws burn on hot asphalt..."
                onChange={(e) => setAgentPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleParsePrompt(agentPrompt); }}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid #93c5fd',
                  fontSize: '12px',
                  outline: 'none',
                  background: 'white'
                }}
              />
              <button
                type="button"
                onClick={() => handleParsePrompt(agentPrompt)}
                disabled={agentLoading || !agentPrompt.trim()}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: '#0284c7',
                  color: 'white',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Parse
              </button>
            </div>
            {/* Quick Presets */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {AGENT_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setAgentPrompt(preset.prompt);
                    handleParsePrompt(preset.prompt);
                  }}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '12px',
                    background: 'white',
                    border: '1px solid #bae6fd',
                    color: '#0369a1',
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Planning Mode Selector (Instant vs Scheduled) */}
          <div className="form-group">
            <label>Planning Mode</label>
            <div style={{ display: 'flex', gap: '6px', background: '#f1f5f9', padding: '4px', borderRadius: '8px' }}>
              <button
                type="button"
                onClick={() => setPlanningMode('instant')}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: '6px',
                  background: planningMode === 'instant' ? '#ffffff' : 'transparent',
                  color: planningMode === 'instant' ? '#0f172a' : '#64748b',
                  fontWeight: planningMode === 'instant' ? 700 : 500,
                  fontSize: '12px',
                  cursor: 'pointer',
                  boxShadow: planningMode === 'instant' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                ⚡ Depart Now (Instant)
              </button>
              <button
                type="button"
                onClick={() => setPlanningMode('scheduled')}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: '6px',
                  background: planningMode === 'scheduled' ? '#ffffff' : 'transparent',
                  color: planningMode === 'scheduled' ? '#0f172a' : '#64748b',
                  fontWeight: planningMode === 'scheduled' ? 700 : 500,
                  fontSize: '12px',
                  cursor: 'pointer',
                  boxShadow: planningMode === 'scheduled' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                ⏱ Scheduled / Deadline
              </button>
            </div>
          </div>

          {/* Scheduled Mode Deadline Slider */}
          {planningMode === 'scheduled' && (
            <div className="form-group" style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#334155', fontWeight: 600, marginBottom: '6px' }}>
                <span>Target Arrival Window</span>
                <span style={{ color: '#2563eb' }}>Within {deadlineMinutes} minutes</span>
              </div>
              <input
                type="range"
                min="15"
                max="120"
                step="15"
                value={deadlineMinutes}
                onChange={(e) => setDeadlineMinutes(parseInt(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                CoolPath will scan multi-hour microclimate forecasts to tell you the optimal departure time.
              </div>
            </div>
          )}

          {/* Activity Selector */}
          <div className="form-group">
            <label>Choose Activity</label>
            <div className="activity-selector">
              {ACTIVITIES.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  className={`activity-btn ${activity === act.id ? 'activity-btn--active' : ''}`}
                  onClick={() => {
                    setActivity(act.id);
                    setResponse(null);
                  }}
                  disabled={loading}
                >
                  <span className="activity-icon">{act.icon}</span>
                  <span className="activity-name">{act.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Pace Selector */}
          <div className="form-group">
            <label>Pace / Intensity</label>
            <div className="pace-selector">
              {PACES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`pace-btn ${pace === p.id ? 'pace-btn--active' : ''}`}
                  onClick={() => {
                    setPace(p.id);
                    setResponse(null);
                  }}
                  disabled={loading}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Special Profile Tags (Extracted by Gemini) */}
          {specialTags.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Active Agent Tags:</span>
              {specialTags.map((tag, i) => (
                <span key={i} style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: '#e0e7ff', color: '#3730a3', fontWeight: 600 }}>
                  🏷 {tag.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}

          {/* Origin */}
          <LocationSearch
            label="Origin"
            value={origin.name}
            onSelect={handleOriginSelect}
            pinColor="green"
            disabled={loading}
          />

          {/* Destination */}
          <LocationSearch
            label="Destination"
            value={dest.name}
            onSelect={handleDestSelect}
            pinColor="red"
            disabled={loading}
          />

          {/* Map pin buttons */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button
              className={`pin-btn ${pinMode === 'origin' ? 'pin-btn--active-green' : ''}`}
              onClick={() => setPinMode((prev) => (prev === 'origin' ? null : 'origin'))}
              disabled={loading}
            >
              <span style={{ marginRight: '4px' }}>🟢</span>
              {pinMode === 'origin' ? 'Tap map…' : 'Set Origin'}
            </button>
            <button
              className={`pin-btn ${pinMode === 'destination' ? 'pin-btn--active-red' : ''}`}
              onClick={() => setPinMode((prev) => (prev === 'destination' ? null : 'destination'))}
              disabled={loading}
            >
              <span style={{ marginRight: '4px' }}>🔴</span>
              {pinMode === 'destination' ? 'Tap map…' : 'Set Destination'}
            </button>
          </div>

          {/* Distance Badge */}
          <div style={{
            padding: '10px 12px',
            marginBottom: '16px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#334155',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>📏 Distance: <strong>{distanceKm.toFixed(2)} km</strong></span>
            <span>⏱ ~{estimatedMinutes} min {activityVerb.toLowerCase()}</span>
          </div>

          {/* Error banner */}
          {error && (
            <div style={{
              padding: '10px 12px', marginBottom: '12px', borderRadius: '6px',
              background: '#fef2f2', border: '1px solid #fecaca',
              fontSize: '13px', color: '#991b1b', lineHeight: 1.5
            }}>
              ⚠️ {error}
            </div>
          )}

          <button
            className="btn-primary"
            onClick={handlePlan}
            disabled={loading || !backendStatus.online}
          >
            {loading ? `⏳ Planning ${activity} trip…` : !backendStatus.online ? '⚠ Backend Offline' : `🌡 Plan ${currentActivityConfig.label} Route`}
          </button>
        </div>

        {/* Results Section */}
        {response && (
          <div className="results-section">
            {/* ⏱ Scheduled Departure Intelligence Card */}
            {response.planning_mode === 'scheduled' && response.wait_minutes > 0 && (
              <div style={{
                marginBottom: '16px',
                padding: '14px 16px',
                background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                border: '1.5px solid #f59e0b',
                borderRadius: '12px',
                color: '#78350f'
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }}>
                  ⏱ Timing Strategy Recommendation
                </div>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 800 }}>
                  Optimal Departure: {response.optimal_departure_time || `+${response.wait_minutes} min`}
                </h3>
                <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                  Delaying departure by <strong>{response.wait_minutes} minutes</strong> lets surface solar irradiance drop, saving an extra <strong>{response.thermal_reduction_percent}% heat strain</strong>.
                </div>
              </div>
            )}

            {/* 🌡 FortyGuard Multi-Dimensional Environmental Profile */}
            {response.env_summary && (
              <div style={{
                marginBottom: '16px',
                padding: '12px 14px',
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '10px'
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                  🌐 FortyGuard Environmental Profile
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: '#334155' }}>
                  <div>🌡 Apparent Heat: <strong>{response.env_summary.apparent_temp_c}°C</strong></div>
                  <div>☀️ Solar GHI: <strong>{response.env_summary.ghi_solar_w_m2} W/m²</strong></div>
                  <div>💨 Air Quality: <strong>{response.env_summary.air_quality_level}</strong></div>
                  <div>💧 Humidity: <strong>{response.env_summary.relative_humidity_pct}%</strong></div>
                </div>
              </div>
            )}

            {/* ✨ Gemini Agentic Mission Briefing Object Card */}
            {response.gemini_briefing && (
              <div style={{
                marginBottom: '16px',
                padding: '14px 16px',
                background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
                border: '1.5px solid #d8b4fe',
                borderRadius: '12px',
                boxShadow: '0 4px 12px rgba(168, 85, 247, 0.1)'
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#7e22ce', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }}>
                  ✨ CoolPath Assistant Mission Briefing
                </div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 700, color: '#581c87' }}>
                  {response.gemini_briefing.headline}
                </h3>
                <p style={{ margin: '0 0 10px 0', fontSize: '12px', lineHeight: 1.5, color: '#6b21a8' }}>
                  {response.gemini_briefing.narrative}
                </p>
                {response.gemini_briefing.health_alert && (
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#991b1b',
                    marginBottom: '6px'
                  }}>
                    {response.gemini_briefing.health_alert}
                  </div>
                )}
                {response.gemini_briefing.timing_advice && (
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#0369a1' }}>
                    {response.gemini_briefing.timing_advice}
                  </div>
                )}
              </div>
            )}

            {/* Decision Summary */}
            <div className="decision-card">
              <div className="decision-badge" style={{
                background: `${(decisionColor[response.decision] || '#6b7280')}15`,
                color: decisionColor[response.decision] || '#6b7280'
              }}>
                {response.decision.replace(/_/g, ' ')}
              </div>

              {response.decision === 'WAIT_AND_REROUTE' && <div className="decision-title">Wait {response.wait_minutes} min + take cooler {activity} route</div>}
              {response.decision === 'WAIT' && <div className="decision-title">Wait {response.wait_minutes} min before departing</div>}
              {response.decision === 'REROUTE' && <div className="decision-title">Take the cooler alternate {activity} route</div>}
              {response.decision === 'GO' && <div className="decision-title">Go now — direct {activity} route is optimal</div>}

              {(() => {
                const currentReduction = activeRoute ? activeRoute.thermal_reduction_percent : (response.thermal_reduction_percent || 0);
                if (currentReduction > 0) {
                  return (
                    <>
                      <div className="decision-stats" style={{ color: '#10b981' }}>
                        {currentReduction}%
                      </div>
                      <div className="decision-sub">LESS ESTIMATED HEAT EXPOSURE</div>
                    </>
                  );
                } else {
                  return (
                    <>
                      <div className="decision-stats" style={{ color: '#3b82f6', fontSize: '28px', letterSpacing: '-0.5px' }}>
                        OPTIMAL
                      </div>
                      <div className="decision-sub">DIRECT PATH HAS LOWEST TRAVEL TIME & MINIMAL HEAT STRAIN (~{activeRoute?.avg_temp_c || 32.4}°C)</div>
                    </>
                  );
                }
              })()}

              <div style={{ marginTop: '16px', padding: '14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', lineHeight: 1.6, color: '#475569' }}>
                <strong style={{ color: '#1e293b', fontSize: '13px', display: 'block', marginBottom: '4px' }}>
                  Why this route for {currentActivityConfig.label}?
                </strong>
                {activeRoute?.explanation || response.explanation}
              </div>
            </div>

            {/* Interactive Multi-Route Cards Selector */}
            {response.route_options && response.route_options.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                  Available Routes (Click to Compare)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {response.route_options.map((route) => {
                    const isSelected = route.id === selectedRouteId;
                    return (
                      <div
                        key={route.id}
                        onClick={() => setSelectedRouteId(route.id)}
                        className={`route-card ${isSelected ? 'route-card--selected' : ''}`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 700, fontSize: '13px', color: isSelected ? '#1e293b' : '#334155' }}>
                            {route.name}
                          </span>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: route.is_recommended ? '#dcfce7' : '#f1f5f9',
                            color: route.is_recommended ? '#166534' : '#475569'
                          }}>
                            {route.tag}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
                          <span>⏱ {route.travel_minutes} min {activityVerb.toLowerCase()}</span>
                          <span>🌡 ~{route.avg_temp_c}°C avg</span>
                          {route.thermal_reduction_percent > 0 ? (
                            <span style={{ color: '#16a34a', fontWeight: 600 }}>{route.thermal_reduction_percent}% Cooler</span>
                          ) : (
                            <span>Baseline</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Comparison Metrics */}
            {response.comparison && (
              <>
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Fastest</th>
                      <th className="coolpath-col">Selected Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{activityVerb} time</td>
                      <td>{response.comparison.fastest.travel_minutes} min</td>
                      <td className="coolpath-col">{activeRoute ? activeRoute.travel_minutes : response.comparison.recommended.travel_minutes} min</td>
                    </tr>
                    <tr>
                      <td>Avg Temperature</td>
                      <td>~33.5°C</td>
                      <td className="coolpath-col">{activeRoute ? `~${activeRoute.avg_temp_c}°C` : '~31.8°C'}</td>
                    </tr>
                    <tr>
                      <td>Wait time</td>
                      <td>0 min</td>
                      <td className="coolpath-col">{response.wait_minutes} min</td>
                    </tr>
                    <tr>
                      <td>Thermal score</td>
                      <td>{response.comparison.fastest.thermal_exposure}</td>
                      <td className="coolpath-col">{activeRoute ? activeRoute.thermal_exposure : response.comparison.recommended.thermal_exposure}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>

      <section className="map-workspace">
        <div className="workspace-bar">
          <div>
            <span className="workspace-kicker">Live workspace</span>
            <h2>Route and thermal evidence</h2>
          </div>
          <div className="workspace-meta"><MapPin size={14} /> Lower Manhattan operating area</div>
        </div>
        <div className="map-container">
        <Map
          missionResponse={response}
          originCoord={origin}
          destinationCoord={dest}
          pinMode={pinMode}
          onMapClick={handleMapClick}
          selectedRouteId={selectedRouteId}
          onSelectRoute={(id) => setSelectedRouteId(id)}
        />
        </div>
      </section>
      <aside className="insight-panel" aria-live="polite">
        {response && currentDecision ? (() => {
          const DecisionIcon = currentDecision.icon;
          const reasons = response.reason_codes || [];
          const provenance = response.provenance || {};
          return (
            <div className="insight-content">
              <div className="panel-heading-row">
                <div>
                  <span className="workspace-kicker">Decision output</span>
                  <h2>Dispatch recommendation</h2>
                </div>
                <span className="completed-chip"><CheckCircle2 size={13} /> Completed</span>
              </div>
              <div className="decision-hero" style={{ '--decision-color': decisionColor[response.decision] || '#475569' } as React.CSSProperties}>
                <div className="decision-icon"><DecisionIcon size={22} /></div>
                <div>
                  <div className="decision-label">{response.decision.replace(/_/g, ' ')}</div>
                  <div className="decision-title-compact">{currentDecision.title}</div>
                </div>
              </div>
              <div className="decision-status-line"><ShieldCheck size={15} /> {currentDecision.status}</div>
              <section className="insight-section">
                <div className="section-label">Why this decision</div>
                <p className="insight-explanation">{response.explanation || 'The deterministic decision engine evaluated available route and thermal evidence.'}</p>
                <div className="reason-list">
                  {reasons.length > 0 ? reasons.map((reason) => (
                    <span className="reason-chip" key={reason}>{reasonLabels[reason] || reason.replace(/_/g, ' ')}</span>
                  )) : <span className="reason-chip">Evaluation evidence recorded</span>}
                </div>
              </section>
              <section className="insight-section">
                <div className="section-label">Operational checks</div>
                <div className="check-grid">
                  <div><span>SLA</span><strong>{reasons.includes('SLA_VIOLATION') ? 'At risk' : 'Evaluated'}</strong></div>
                  <div><span>Policy</span><strong>{response.decision === 'ESCALATE' ? 'Review required' : 'Evaluated'}</strong></div>
                  <div><span>Authority</span><strong>{response.decision === 'ESCALATE' ? 'Supervisor' : 'Dispatcher'}</strong></div>
                  <div><span>Exposure proxy</span><strong>{activeRoute ? `${activeRoute.thermal_exposure} C-min` : 'Recorded'}</strong></div>
                </div>
              </section>
              <section className="evidence-section">
                <div className="section-label"><ThermometerSun size={14} /> Evidence and provenance</div>
                <div className="evidence-list">
                  <div><span>Thermal source</span><strong>{provenance.thermal_provider || 'FortyGuard'}</strong></div>
                  <div><span>Evidence state</span><strong>{provenance.thermal_data_mode || 'Recorded'}</strong></div>
                  <div><span>Route source</span><strong>{provenance.routing_provider || 'Geoapify'}</strong></div>
                  <div><span>Persistence</span><strong><Database size={13} /> {provenance.persistence || 'PERSISTED'}</strong></div>
                </div>
                <p className="metric-note">TEMP_TIME_PROXY_C_MIN is an operational environmental exposure proxy, not a medical safety measure.</p>
              </section>
              <div className="mission-footer"><span>Mission {response.mission_id || 'recorded'}</span><span>Version {response.mission_version || 1}</span></div>
            </div>
          );
        })() : (
          <div className="empty-insight">
            <div className="empty-icon"><Bot size={23} /></div>
            <span className="workspace-kicker">Decision workspace</span>
            <h2>Evaluate a mission to begin</h2>
            <p>CoolPath compares route, timing, thermal evidence, and configured policy before returning a dispatch recommendation.</p>
            <div className="empty-steps"><span><Activity size={14} /> Intake</span><span><Navigation size={14} /> Evidence</span><span><ShieldCheck size={14} /> Decision</span></div>
          </div>
        )}
      </aside>
      </main>
    </div>
  );
}

export default App;
