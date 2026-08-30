import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MissionResponse, RouteOption } from '../types/mission';

export type PinMode = 'origin' | 'destination' | null;

interface MapProps {
  missionResponse: MissionResponse | null;
  originCoord: { lat: number; lng: number } | null;
  destinationCoord: { lat: number; lng: number } | null;
  pinMode: PinMode;
  onMapClick: (lat: number, lng: number) => void;
  selectedRouteId?: string;
  onSelectRoute?: (id: string) => void;
}

const ROUTE_COLORS: Record<string, string> = {
  coolest: '#10B981',   // Emerald Green
  fastest: '#64748B',   // Slate Gray
  route_1: '#3B82F6',   // Blue
  route_2: '#8B5CF6',   // Purple
  route_3: '#F59E0B',   // Amber
};

// Custom DivIcons to replace Mapbox elements
const originIcon = L.divIcon({
  className: 'custom-pin-origin',
  html: `<div style="width: 18px; height: 18px; border-radius: 50%; background: #10b981; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const destIcon = L.divIcon({
  className: 'custom-pin-dest',
  html: `<div style="width: 18px; height: 18px; border-radius: 50%; background: #ef4444; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// Component to handle map clicks for pin mode
const MapClickHandler = ({ pinMode, onMapClick }: { pinMode: PinMode, onMapClick: (lat: number, lng: number) => void }) => {
  const map = useMapEvents({
    click(e) {
      if (pinMode) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    }
  });

  useEffect(() => {
    if (pinMode) {
      map.getContainer().style.cursor = 'crosshair';
    } else {
      map.getContainer().style.cursor = '';
    }
  }, [pinMode, map]);

  return null;
};

// Component to automatically fit bounds
const MapBoundsFitter = ({ 
  originCoord, 
  destinationCoord,
  routes
}: { 
  originCoord: { lat: number; lng: number } | null, 
  destinationCoord: { lat: number; lng: number } | null,
  routes: RouteOption[]
}) => {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds([]);
    let hasCoords = false;

    if (originCoord) {
      bounds.extend([originCoord.lat, originCoord.lng]);
      hasCoords = true;
    }
    if (destinationCoord) {
      bounds.extend([destinationCoord.lat, destinationCoord.lng]);
      hasCoords = true;
    }

    routes.forEach(route => {
      if (route.coordinates && route.coordinates.length > 0) {
        route.coordinates.forEach(c => {
          // GeoJSON is [lng, lat], Leaflet is [lat, lng]
          bounds.extend([c[1], c[0]]);
        });
        hasCoords = true;
      }
    });

    if (hasCoords) {
      map.flyToBounds(bounds, { padding: [50, 50], duration: 1.0 });
    }
  }, [map, originCoord, destinationCoord, routes]);

  return null;
};

const Map: React.FC<MapProps> = ({
  missionResponse,
  originCoord,
  destinationCoord,
  pinMode,
  onMapClick,
  selectedRouteId,
  onSelectRoute
}) => {
  let routeOptions: RouteOption[] = missionResponse?.route_options || [];

  if (routeOptions.length === 0 && missionResponse?.routes) {
    if (missionResponse.routes.fastest?.length > 1) {
      routeOptions.push({
        id: 'fastest',
        name: 'Direct Fastest',
        tag: '⚡ Fastest',
        travel_minutes: missionResponse.comparison?.fastest?.travel_minutes || 0,
        avg_temp_c: 33.5,
        thermal_exposure: missionResponse.comparison?.fastest?.thermal_exposure || 55,
        thermal_reduction_percent: 0,
        coordinates: missionResponse.routes.fastest,
        explanation: '',
        is_recommended: false,
      });
    }
    if (missionResponse.routes.recommended?.length > 1) {
      routeOptions.push({
        id: 'recommended',
        name: 'CoolPath Route',
        tag: '❄️ Coolest',
        travel_minutes: missionResponse.comparison?.recommended?.travel_minutes || 0,
        avg_temp_c: 31.8,
        thermal_exposure: missionResponse.comparison?.recommended?.thermal_exposure || 45,
        thermal_reduction_percent: missionResponse.thermal_reduction_percent || 0,
        coordinates: missionResponse.routes.recommended,
        explanation: missionResponse.explanation || '',
        is_recommended: true,
      });
    }
  }

  const activeId = selectedRouteId || routeOptions[0]?.id;

  // Render unselected routes first, then selected on top
  const sortedRoutes = [...routeOptions].sort((a, b) => {
    if (a.id === activeId) return 1;
    if (b.id === activeId) return -1;
    return 0;
  });

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer 
        center={[40.7110, -74.0090]} 
        zoom={14} 
        style={{ width: '100%', height: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        <MapClickHandler pinMode={pinMode} onMapClick={onMapClick} />
        <MapBoundsFitter originCoord={originCoord} destinationCoord={destinationCoord} routes={routeOptions} />

        {originCoord && (
          <Marker position={[originCoord.lat, originCoord.lng]} icon={originIcon}>
            <Popup><strong>Origin</strong></Popup>
          </Marker>
        )}

        {destinationCoord && (
          <Marker position={[destinationCoord.lat, destinationCoord.lng]} icon={destIcon}>
            <Popup><strong>Destination</strong></Popup>
          </Marker>
        )}

        {sortedRoutes.map(route => {
          if (!route.coordinates || route.coordinates.length < 2) return null;
          
          const isSelected = route.id === activeId;
          const baseColor = ROUTE_COLORS[route.id] || (route.is_recommended ? '#10B981' : route.id === 'fastest' ? '#64748B' : '#3B82F6');
          const color = isSelected ? (route.is_recommended ? '#10B981' : '#2563EB') : baseColor;
          
          // Convert GeoJSON [lng, lat] to Leaflet [lat, lng]
          const positions = route.coordinates.map(c => [c[1], c[0]] as [number, number]);

          return (
            <React.Fragment key={route.id}>
              {/* Invisible Hit Area Polyline */}
              <Polyline 
                positions={positions}
                pathOptions={{ color: 'transparent', weight: 16 }}
                eventHandlers={{
                  click: () => onSelectRoute && onSelectRoute(route.id)
                }}
              />
              {/* Visible Polyline */}
              <Polyline 
                positions={positions}
                pathOptions={{ 
                  color, 
                  weight: isSelected ? 6 : 4,
                  opacity: isSelected ? 1.0 : 0.45,
                  dashArray: isSelected ? undefined : '5, 5'
                }}
                interactive={false}
              />
            </React.Fragment>
          );
        })}
      </MapContainer>

      {/* Crosshair overlay hint */}
      {pinMode && (
        <div style={{
          position: 'absolute',
          top: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: pinMode === 'origin' ? '#10b981' : '#ef4444',
          color: 'white',
          padding: '8px 16px',
          borderRadius: '20px',
          fontSize: '13px',
          fontWeight: 600,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          pointerEvents: 'none',
          zIndex: 1000
        }}>
          {pinMode === 'origin' ? '🟢' : '🔴'} Click to set {pinMode === 'origin' ? 'origin' : 'destination'}
        </div>
      )}

      {/* Interactive Map Route Legend */}
      {routeOptions.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '30px',
          left: '16px',
          background: 'var(--panel-bg)',
          borderRadius: '10px',
          padding: '12px 16px',
          boxShadow: 'var(--shadow-lg)',
          fontSize: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxWidth: '220px',
          zIndex: 1000,
          border: '1px solid var(--border-color)',
          color: 'var(--foreground)'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Routes (Click to select)
          </span>
          {routeOptions.map((r) => {
            const isSel = r.id === activeId;
            const color = ROUTE_COLORS[r.id] || (r.is_recommended ? '#10B981' : r.id === 'fastest' ? '#64748B' : '#3B82F6');
            return (
              <div
                key={r.id}
                onClick={() => onSelectRoute && onSelectRoute(r.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  padding: '4px 6px',
                  borderRadius: '6px',
                  background: isSel ? 'var(--panel-bg-elevated)' : 'transparent',
                  fontWeight: isSel ? 700 : 500,
                  color: isSel ? 'var(--foreground)' : 'var(--text-muted)'
                }}
              >
                <div style={{
                  width: '18px',
                  height: isSel ? '4px' : '3px',
                  background: isSel ? (r.is_recommended ? '#10B981' : '#2563EB') : color,
                  borderRadius: '2px'
                }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name} ({r.travel_minutes}m)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Map;
