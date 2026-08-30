import { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, MapPin, Navigation, Sparkles, ThermometerSun, Mic, ShieldAlert } from 'lucide-react';
import Map, { type PinMode } from './components/Map';
import LocationSearch, { type GeoResult } from './components/LocationSearch';
import ThermalDispatchField from './components/ThermalDispatchField';
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


function App() {
  const [loading, setLoading] = useState(false);
  const [evalStep, setEvalStep] = useState<string>('Initializing...');
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

  // Streaming Loading Effect
  useEffect(() => {
    if (loading) {
      const t1 = setTimeout(() => setEvalStep('Evaluating Thermal Risk...'), 800);
      const t2 = setTimeout(() => setEvalStep('Generating Decision...'), 1800);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [loading]);

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
    const shortName = `[LAT] ${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} / [LNG] ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
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
    setEvalStep('Parsing Intent & Routing...');
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



  const currentDecision = response ? decisionMeta[response.decision] || {
    title: response.decision.replace(/_/g, ' '),
    status: 'Mission Evaluated',
    icon: Activity,
  } : null;



  // Dynamic location context derived from origin
  const locationContext = useMemo(() => {
    const name = origin.name || '';
    // Extract a short, readable place name from the geocoded display_name
    const parts = name.split(',').map(s => s.trim());
    if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`;
    if (parts.length === 1 && parts[0].length > 0) return parts[0];
    return `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`;
  }, [origin]);

  // Determine if the user has customized origin/dest from defaults
  const hasCustomLocations = origin.name !== 'Lower Manhattan, New York' || dest.name !== 'Financial District, New York';

  const fieldState = loading ? 'evaluating' : response ? 'result' : 'empty';

  return (
    <div className="app-shell">
      {/* P1.8 — Top Bar */}
      <header className="app-topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><ThermometerSun size={19} strokeWidth={2.4} /></div>
          <div>
            <div className="brand-name">CoolPath Ops</div>
            <div className="brand-subtitle">Thermal Dispatch Gate</div>
          </div>
        </div>
        <div className="system-status">
          <span className="status-muted">System</span>
          <div className={`status-dot ${backendStatus.online ? 'status-dot--online' : ''}`} />
          <span>{backendStatus.online ? 'Online' : 'Offline'}</span>
        </div>
      </header>

      {/* P0 — Core Layout */}
      <main className="console-layout" style={{ position: 'relative' }}>
        <ThermalDispatchField state={fieldState} />
        
        {/* ===== LEFT: Mission Control ===== */}
        <aside className="sidebar" style={{ position: 'relative', zIndex: 10 }}>
          <div className="header">
            <h1 style={{ margin: '0 0 4px 0' }}>Mission Control</h1>
            <p style={{ margin: 0 }}>Configure the work order to evaluate.</p>
          </div>

          <div className="form-section">
            {/* Mission Assistant Prompt */}
            <div className="assistant-bar">
              <div className="assistant-kicker">
                <Sparkles size={13} /> Mission Assistant
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  title="Use Voice (Demo)"
                  className="voice-btn"
                >
                  <Mic size={16} />
                </button>
                <input
                  type="text"
                  value={agentPrompt}
                  placeholder="e.g. dispatch walking crew to Times Square"
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleParsePrompt(agentPrompt); }}
                  disabled={loading || !backendStatus.online}
                  className="assistant-input"
                />
                <button
                  type="button"
                  onClick={() => handleParsePrompt(agentPrompt)}
                  disabled={agentLoading || !agentPrompt.trim() || !backendStatus.online}
                  className="assistant-submit"
                >
                  {agentLoading ? '…' : 'Parse'}
                </button>
              </div>
            </div>

            {/* Planning Mode and Pace Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.8px' }}>Depart</label>
                <div className="pace-selector">
                  <button type="button" className={`pace-btn ${planningMode === 'instant' ? 'pace-btn--active' : ''}`} onClick={() => setPlanningMode('instant')}>Now</button>
                  <button type="button" className={`pace-btn ${planningMode === 'scheduled' ? 'pace-btn--active' : ''}`} onClick={() => setPlanningMode('scheduled')}>Later</button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.8px' }}>Pace</label>
                <div className="pace-selector">
                  {PACES.map((p) => (
                    <button key={p.id} type="button" className={`pace-btn ${pace === p.id ? 'pace-btn--active' : ''}`} onClick={() => { setPace(p.id); setResponse(null); }} disabled={loading}>{p.label}</button>
                  ))}
                </div>
              </div>
            </div>

            {planningMode === 'scheduled' && (
              <div className="form-group" style={{ background: 'var(--bg-color)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '6px' }}>
                  <span>Maximum Departure Delay</span>
                  <span style={{ color: 'var(--primary)' }}>{deadlineMinutes} min</span>
                </div>
                <input
                  type="range" min="15" max="120" step="15"
                  value={deadlineMinutes}
                  onChange={(e) => setDeadlineMinutes(parseInt(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>
            )}

            {/* Activity */}
            <div className="form-group">
              <label>Activity</label>
              <div className="activity-selector">
                {ACTIVITIES.map((act) => (
                  <button
                    key={act.id} type="button"
                    className={`activity-btn ${activity === act.id ? 'activity-btn--active' : ''}`}
                    onClick={() => { setActivity(act.id); setResponse(null); }}
                    disabled={loading}
                  >
                    <span className="activity-icon">{act.icon}</span>
                    <span className="activity-name">{act.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Origin / Destination */}
            <LocationSearch label="Origin" value={origin.name} onSelect={handleOriginSelect} pinColor="green" disabled={loading} />
            <LocationSearch label="Destination" value={dest.name} onSelect={handleDestSelect} pinColor="red" disabled={loading} />

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button
                className={`pin-btn ${pinMode === 'origin' ? 'pin-btn--active-green' : ''}`}
                onClick={() => setPinMode((prev) => (prev === 'origin' ? null : 'origin'))}
                disabled={loading}
              >
                {pinMode === 'origin' ? 'Tap map…' : 'Set Origin'}
              </button>
              <button
                className={`pin-btn ${pinMode === 'destination' ? 'pin-btn--active-red' : ''}`}
                onClick={() => setPinMode((prev) => (prev === 'destination' ? null : 'destination'))}
                disabled={loading}
              >
                {pinMode === 'destination' ? 'Tap map…' : 'Set Destination'}
              </button>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                padding: '10px 12px', marginBottom: '12px', borderRadius: '6px',
                background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
                fontSize: '13px', color: 'var(--thermal-hot)', lineHeight: 1.5
              }}>
                ⚠️ {error}
              </div>
            )}

            {/* P1.7 — Primary CTA */}
            <button
              className={`btn-primary ${loading ? 'btn-primary--loading' : ''}`}
              onClick={handlePlan}
              disabled={loading || !backendStatus.online}
            >
              {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="streaming-spinner" />
                  {evalStep}
                </div>
              ) : !backendStatus.online ? 'Backend Offline' : 'EVALUATE MISSION'}
            </button>
          </div>
        </aside>

        {/* ===== CENTER: Operational Map ===== */}
        <section className="map-workspace" style={{ position: 'relative', zIndex: 10 }}>
          <div className="workspace-bar">
            <div>
              <span className="workspace-kicker">Operational Map</span>
              <h2>Route & Thermal Evidence</h2>
            </div>
            <div className="workspace-meta"><MapPin size={13} /> {locationContext}</div>
          </div>
          <div className="map-container">
            {/* P1.1 — Map First-Frame Overlay */}
            <div className={`map-overlay ${(response || loading || hasCustomLocations) ? 'map-overlay--hidden' : ''}`}>
              <div className="map-overlay-card">
                <h3>SET THE MISSION</h3>
                <p>Choose or describe the work order to evaluate route, timing, thermal evidence, and operational policy.</p>
              </div>
            </div>
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

        {/* ===== RIGHT: Decision Intelligence ===== */}
        <aside className="insight-panel" aria-live="polite" style={{ position: 'relative', zIndex: 10 }}>
          {/* P1.2 — Evaluating State */}
          {loading ? (
            <div className="evaluating-state">
              <h2>Evaluating mission…</h2>
              <p>Comparing route, timing, thermal evidence and policy.</p>
            </div>
          ) : response && currentDecision ? (() => {
            const DecisionIcon = currentDecision.icon;
            const reasons = response.reason_codes || [];
            const provenance = response.provenance || {};
            return (
              <div className="insight-content">
                {/* Heading */}
                <div className="panel-heading-row">
                  <div>
                    <span className="workspace-kicker">Decision Output</span>
                    <h2>Dispatch Recommendation</h2>
                  </div>
                  <span className="completed-chip"><CheckCircle2 size={12} /> Complete</span>
                </div>

                {/* 1. ACTION — Decision Hero */}
                <div className="decision-hero" style={{ '--decision-color': decisionColor[response.decision] || '#475569' } as React.CSSProperties}>
                  <div className="decision-icon"><DecisionIcon size={20} /></div>
                  <div>
                    <div className="decision-label">{response.decision.replace(/_/g, ' ')}</div>
                    <div className="decision-title-compact">{currentDecision.title}</div>
                  </div>
                </div>

                {/* 2. WHY */}
                <div className="why-section">
                  <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>System Rationale</div>
                  {response.explanation || 'The deterministic decision engine evaluated available route and thermal evidence.'}
                </div>

                {/* 3–7. Compact policy/SLA/evidence/authority rows */}
                <div className="decision-row">
                  <span className="decision-row-label">Trade-Off</span>
                  <span className="decision-row-value">
                    {response.wait_minutes > 0
                      ? `Departure +${response.wait_minutes} min`
                      : 'Direct baseline route'}
                  </span>
                </div>
                <div className="decision-row">
                  <span className="decision-row-label">SLA</span>
                  <span className={`decision-row-value ${reasons.includes('SLA_VIOLATION') ? 'decision-row-value--danger' : 'decision-row-value--ok'}`}>
                    {reasons.includes('SLA_VIOLATION') ? 'Violation Risk' : 'Satisfied'}
                  </span>
                </div>
                <div className="decision-row">
                  <span className="decision-row-label">Policy</span>
                  <span className={`decision-row-value ${reasons.includes('THERMAL_POLICY_CONFLICT') ? 'decision-row-value--danger' : 'decision-row-value--ok'}`}>
                    {reasons.includes('THERMAL_POLICY_CONFLICT') ? 'Conflict' : 'Satisfied'}
                  </span>
                </div>
                <div className="decision-row">
                  <span className="decision-row-label">Evidence</span>
                  <span className="decision-row-value">FortyGuard · {provenance.thermal_data_mode || 'LIVE'}</span>
                </div>
                <div className="decision-row" style={response.decision === 'ESCALATE' ? { background: 'rgba(239, 68, 68, 0.05)' } : undefined}>
                  <span className="decision-row-label">Authority</span>
                  <span className={`decision-row-value ${response.decision === 'ESCALATE' ? 'decision-row-value--danger' : ''}`}>
                    {response.decision === 'ESCALATE' ? 'Supervisor review required' : 'No approval required'}
                  </span>
                </div>

                {response.decision === 'ESCALATE' && (
                  <button className="escalate-cta">
                    <ShieldAlert size={14} /> Review with Supervisor
                  </button>
                )}

                {/* Technical evidence — collapsible */}
                <details className="evidence-details">
                  <summary>System Rationale</summary>
                  <div className="evidence-details-content" style={{ gap: '12px', paddingBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ padding: '6px', background: 'rgba(14, 165, 233, 0.1)', borderRadius: '6px', color: 'var(--primary)' }}>
                        <ShieldAlert size={16} />
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Primary Reason</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
                          {reasons.length > 0 ? reasons.map(r => r.replace(/_/g, ' ')).join(', ') : 'Optimal route selected based on thermal safety limits.'}
                        </div>
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                      <div style={{ flex: 1, padding: '10px', background: 'var(--bg-color)', border: '1px solid var(--border-light)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Thermal Data</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <ThermometerSun size={14} color="var(--thermal-warm)" /> {provenance.thermal_provider || 'FortyGuard'}
                        </div>
                      </div>
                      <div style={{ flex: 1, padding: '10px', background: 'var(--bg-color)', border: '1px solid var(--border-light)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Routing Engine</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Navigation size={14} color="var(--primary)" /> {provenance.routing_provider || 'Geoapify'}
                        </div>
                      </div>
                    </div>
                  </div>
                </details>

                {/* Secondary: Gemini briefing — collapsible */}
                {response.gemini_briefing && (
                  <details className="evidence-details">
                    <summary>Mission Briefing</summary>
                    <div className="evidence-details-content">
                      <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                        {response.gemini_briefing.headline}
                      </h4>
                      <p style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--text-secondary)', margin: 0 }}>
                        {response.gemini_briefing.narrative}
                      </p>
                      {response.gemini_briefing.health_alert && (
                        <div style={{
                          marginTop: '8px', padding: '8px 10px', borderRadius: '6px',
                          background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.15)',
                          fontSize: '12px', fontWeight: 600, color: 'var(--thermal-hot)',
                        }}>
                          {response.gemini_briefing.health_alert}
                        </div>
                      )}
                      {response.gemini_briefing.timing_advice && (
                        <div style={{ marginTop: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--primary)' }}>
                          {response.gemini_briefing.timing_advice}
                        </div>
                      )}
                    </div>
                  </details>
                )}

                {/* Secondary: Environmental profile — collapsible */}
                {response.env_summary && (
                  <details className="evidence-details">
                    <summary>Environmental Profile</summary>
                    <div className="evidence-details-content" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div style={{ padding: '12px', background: 'var(--bg-color)', border: '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Feels Like</span>
                        <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--thermal-hot)' }}>{response.env_summary.apparent_temp_c}°C</span>
                      </div>
                      <div style={{ padding: '12px', background: 'var(--bg-color)', border: '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Humidity</span>
                        <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--primary)' }}>{response.env_summary.relative_humidity_pct}%</span>
                      </div>
                      <div style={{ padding: '12px', background: 'var(--bg-color)', border: '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Solar Radiation</span>
                        <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--thermal-warm)' }}>{response.env_summary.ghi_solar_w_m2} W/m²</span>
                      </div>
                      <div style={{ padding: '12px', background: 'var(--bg-color)', border: '1px solid var(--border-light)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Air Quality</span>
                        <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{response.env_summary.air_quality_level}</span>
                      </div>
                    </div>
                  </details>
                )}

                {/* Secondary: Route comparison — collapsible */}
                {response.route_options && response.route_options.length > 0 && (
                  <details className="evidence-details">
                    <summary>Route Comparison ({response.route_options.length})</summary>
                    <div className="evidence-details-content" style={{ gap: '6px' }}>
                      {response.route_options.map((route) => {
                        const isSelected = route.id === selectedRouteId;
                        return (
                          <div
                            key={route.id}
                            onClick={() => setSelectedRouteId(route.id)}
                            className={`route-card ${isSelected ? 'route-card--selected' : ''}`}
                            style={{ padding: '10px 12px' }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <span style={{ fontWeight: 700, fontSize: '12px', color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                {route.name}
                              </span>
                              {route.is_recommended && (
                                <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--thermal-cool)' }}>
                                  Recommended
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
                              <span>⏱ {route.travel_minutes} min</span>
                              <span>🌡 {route.avg_temp_c}°C avg</span>
                              {route.thermal_reduction_percent > 0 && (
                                <span style={{ color: 'var(--thermal-cool)', fontWeight: 600 }}>-{route.thermal_reduction_percent}%</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}

                {/* Scheduled departure timing */}
                {response.planning_mode === 'scheduled' && response.wait_minutes > 0 && (
                  <div className="secondary-card" style={{ borderLeft: '3px solid var(--thermal-warm)' }}>
                    <div className="secondary-card-label">Timing Strategy</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      Optimal Departure: {response.optimal_departure_time || `+${response.wait_minutes} min`}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      Delaying by <strong style={{ color: 'var(--text-primary)' }}>{response.wait_minutes} min</strong> reduces thermal exposure by <strong style={{ color: 'var(--text-primary)' }}>{response.thermal_reduction_percent}%</strong>.
                    </div>
                  </div>
                )}

              </div>
            );
          })() : (
            /* P1.4 — Empty state */
            <div className="empty-insight">
              <div className="empty-icon">
                <MapPin size={22} />
              </div>
              <h2>Decision Intelligence</h2>
              <p>Evaluate a mission to generate dispatch recommendations, policy checks, and thermal evidence.</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );

}

export default App;
