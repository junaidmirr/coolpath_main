import React, { useRef, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, Animated } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import type { Coordinate, MissionResponse } from '../types/mission';

export const MAPBOX_ACCESS_TOKEN =
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN ||
  'pk.eyJ1IjoianVuYWlkbWlyMDUxIiwiYSI6ImNtc3l0MWFwNjAzMmsyenNrbW1mMjI0aHcifQ.j8_w_jQUiv26L8QYQVSBVA';

export type MapStyleType = 'streets' | 'dark' | 'light' | 'satellite' | 'outdoors';
export type PinMode = 'origin' | 'destination' | null;

export interface NavPositionData {
  lat: number;
  lng: number;
  bearing?: number;
  mode?: string;
  followCamera?: boolean;
}

interface MobileMapProps {
  missionResponse: MissionResponse | null;
  originCoord: Coordinate;
  destinationCoord: Coordinate;
  selectedRouteId: string;
  pinMode?: PinMode;
  mapStyle?: MapStyleType;
  navPosition?: NavPositionData | null;
  navSpeakerText?: string | null;
  onGpsUpdate?: (lat: number, lng: number, speed: number, heading: number) => void;
  onGpsError?: (msg: string) => void;
  onCurrentLocation?: (lat: number, lng: number) => void;
  requestCurrentLocationSignal?: number;
  flyToCoord?: Coordinate | null;
  onSelectRoute?: (routeId: string) => void;
  onMapClick?: (lat: number, lng: number, mode?: PinMode) => void;
  onPinMoved?: (pin: 'origin' | 'destination', lat: number, lng: number) => void;
  onMapCanvasTap?: () => void;
  userHeading?: number | null;
}

function buildMapHtml(token: string, style: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.2.0/mapbox-gl.css" rel="stylesheet"/>
<script src="https://api.mapbox.com/mapbox-gl-js/v3.2.0/mapbox-gl.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body,#map{width:100%;height:100%;background:#0f172a;}
.mapboxgl-ctrl-attrib,.mapboxgl-ctrl-logo{display:none!important;}
.mapboxgl-ctrl-bottom-right{bottom:74px!important;right:14px!important;}

.pin{width:26px;height:26px;border-radius:50%;border:3px solid #fff;box-shadow:0 3px 12px rgba(0,0,0,.6);cursor:grab;}
.pin-origin{background:#10B981;box-shadow:0 0 0 7px rgba(16,185,129,.28),0 3px 12px rgba(0,0,0,.6);}
.pin-dest{background:#EF4444;box-shadow:0 0 0 7px rgba(239,68,68,.28),0 3px 12px rgba(0,0,0,.6);}

.pin-hint{position:absolute;top:14px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,.92);color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;font-weight:700;padding:8px 18px;border-radius:24px;pointer-events:none;z-index:99;border:1px solid rgba(255,255,255,.2);display:none;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.4);}
</style>
</head>
<body>
<div id="map"></div>
<div class="pin-hint" id="hint"></div>
<script>
(function() {
  'use strict';

  function postRN(obj) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }

  mapboxgl.accessToken = '${token}';

  const map = new mapboxgl.Map({
    container: 'map',
    style: '${style}',
    center: [-73.9855, 40.758],
    zoom: 13,
    attributionControl: false
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');


  let originMarker = null;
  let destMarker = null;
  let activePinMode = null;
  let isMapReady = false;
  let pendingPayload = null;
  let is3D = false;
  let isSolo = false;
  const routeLayers = [];
  const routeSources = [];

  // Register clean directional chevron arrow icon
  function registerArrowIcon() {
    if (map.hasImage('nav-chevron')) return;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      '<polygon points="6,6 26,16 6,26 12,16" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.5" stroke-linejoin="round"/>' +
      '</svg>';
    const img = new Image(32, 32);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    img.onload = function() {
      if (!map.hasImage('nav-chevron')) {
        map.addImage('nav-chevron', img);
      }
    };
  }

  function clearRoutes() {
    try {
      const style = map.getStyle();
      if (style && style.layers) {
        for (let i = 0; i < style.layers.length; i++) {
          const lId = style.layers[i].id;
          if (
            lId.startsWith('line-') || lId.startsWith('glow-') || 
            lId.startsWith('casing-') || lId.startsWith('arrow-') || 
            lId.startsWith('turn-') || lId.startsWith('rl-') || lId.startsWith('rg-') ||
            lId.startsWith('temp-')
          ) {
            try { map.removeLayer(lId); } catch(e) {}
          }
        }
      }
    } catch(e) {}

    routeLayers.forEach(function(id) {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch(e) {}
    });
    routeLayers.length = 0;

    try {
      const style = map.getStyle();
      if (style && style.sources) {
        const sKeys = Object.keys(style.sources);
        for (let j = 0; j < sKeys.length; j++) {
          const sId = sKeys[j];
          if (sId.startsWith('src-') || sId.startsWith('turn-src-') || sId.startsWith('rs-') || sId.startsWith('temp-src-')) {
            try { map.removeSource(sId); } catch(e) {}
          }
        }
      }
    } catch(e) {}

    routeSources.forEach(function(id) {
      try { if (map.getSource(id)) map.removeSource(id); } catch(e) {}
    });
    routeSources.length = 0;
  }

  function updateMarker(type, lng, lat) {
    if (!isFinite(lng) || !isFinite(lat)) return;
    if (type === 'origin') {
      if (originMarker) {
        originMarker.setLngLat([lng, lat]);
      } else {
        const el = document.createElement('div');
        el.className = 'pin pin-origin';
        const arrow = document.createElement('div');
        arrow.id = 'origin-heading-arrow';
        arrow.style.cssText = 'position: absolute; top: -12px; left: 7px; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 10px solid #10B981; transition: transform 0.3s ease-out; transform-origin: 50% 25px; display: none;';
        el.appendChild(arrow);

        originMarker = new mapboxgl.Marker({ element: el, draggable: true })
          .setLngLat([lng, lat]).addTo(map);
        originMarker.on('dragend', function() {
          const p = originMarker.getLngLat();
          postRN({ type: 'pin_moved', pin: 'origin', lat: p.lat, lng: p.lng });
        });
      }
    } else {
      if (destMarker) {
        destMarker.setLngLat([lng, lat]);
      } else {
        const el = document.createElement('div');
        el.className = 'pin pin-dest';
        destMarker = new mapboxgl.Marker({ element: el, draggable: true })
          .setLngLat([lng, lat]).addTo(map);
        destMarker.on('dragend', function() {
          const p = destMarker.getLngLat();
          postRN({ type: 'pin_moved', pin: 'destination', lat: p.lat, lng: p.lng });
        });
      }
    }
  }

  function calculateTurns(coords) {
    if (!coords || coords.length < 3) return [];
    const turnPoints = [];
    for (let i = 1; i < coords.length - 1; i++) {
      const pPrev = coords[i - 1];
      const pCurr = coords[i];
      const pNext = coords[i + 1];
      
      const b1 = Math.atan2(pCurr[0] - pPrev[0], pCurr[1] - pPrev[1]) * 180 / Math.PI;
      const b2 = Math.atan2(pNext[0] - pCurr[0], pNext[1] - pCurr[1]) * 180 / Math.PI;
      let angle = Math.abs(b2 - b1);
      if (angle > 180) angle = 360 - angle;
      
      // Significant turn corner (> 30 degrees)
      if (angle > 30) {
        turnPoints.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: pCurr },
          properties: { angle: Math.round(angle) }
        });
      }
    }
    return turnPoints;
  }

  function drawRoutes(routes, soloMode) {
    clearRoutes();
    if (!routes || routes.length === 0) return;
    registerArrowIcon();

    const bounds = new mapboxgl.LngLatBounds();
    let hasBounds = false;

    // Draw unselected first so selected renders prominently on top
    const sorted = routes.slice().sort(function(a, b) {
      return (a.selected ? 1 : 0) - (b.selected ? 1 : 0);
    });

    for (let ri = 0; ri < sorted.length; ri++) {
      const route = sorted[ri];
      const coords = route.coords;
      if (!coords || !Array.isArray(coords) || coords.length < 2) continue;

      if (soloMode && !route.selected) continue;

      // Validate coordinates
      const valid = [];
      for (let ci = 0; ci < coords.length; ci++) {
        const c = coords[ci];
        if (Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1])) {
          valid.push([c[0], c[1]]);
        }
      }
      if (valid.length < 2) continue;

      for (let vi = 0; vi < valid.length; vi++) {
        bounds.extend(valid[vi]);
        hasBounds = true;
      }

      const srcId    = 'src-' + route.id;
      const casingId = 'casing-' + route.id;
      const glowId   = 'glow-' + route.id;
      const lineId   = 'line-' + route.id;
      const arrowId  = 'arrow-' + route.id;
      const turnSrcId = 'turn-src-' + route.id;
      const turnId   = 'turn-' + route.id;

      // Compute gradient BEFORE adding source, so we know if lineMetrics is needed
      let lineGradientExpression = null;
      const gTemps = (route.selected && route.geometry_temps && route.geometry_temps.length >= 2) ? route.geometry_temps : null;

      if (gTemps) {
        const distances = [0];
        let totalDist = 0;
        for (let i = 1; i < gTemps.length; i++) {
          const p1 = gTemps[i - 1];
          const p2 = gTemps[i];
          // Use Haversine-approximation in degrees for progress proportion
          const dx = (p2[0] - p1[0]) * Math.cos((p1[1] + p2[1]) * Math.PI / 360.0);
          const dy = p2[1] - p1[1];
          const d = Math.sqrt(dx*dx + dy*dy);
          totalDist += d;
          distances.push(totalDist);
        }

        if (totalDist > 0) {
          const getColorForTemp = function(t) {
            if (t <= 24) return '#10B981'; // Cool Green
            if (t <= 28) return '#38BDF8'; // Mild Blue
            if (t <= 33) return '#F59E0B'; // Warm Amber
            return '#EF4444'; // Hot Red
          };

          // Clamp progress to [0, 1] and ensure monotonically increasing stops
          const stops = [];
          let lastProgress = -1;
          for (let i = 0; i < gTemps.length; i++) {
            let progress = distances[i] / totalDist;
            // Mapbox requires strictly increasing stop values
            if (progress <= lastProgress) progress = lastProgress + 0.001;
            if (progress > 1.0) progress = 1.0;
            stops.push(progress, getColorForTemp(gTemps[i][2]));
            lastProgress = progress;
          }

          lineGradientExpression = ['interpolate', ['linear'], ['line-progress']].concat(stops);
        }
      }

      // 1. Source Setup — MUST remove+recreate to set lineMetrics=true for gradient
      // (lineMetrics cannot be changed on an existing source)
      try { if (map.getLayer(casingId)) map.removeLayer(casingId); } catch(e) {}
      try { if (map.getLayer(glowId))   map.removeLayer(glowId);   } catch(e) {}
      try { if (map.getLayer(lineId))   map.removeLayer(lineId);   } catch(e) {}
      try { if (map.getLayer(arrowId))  map.removeLayer(arrowId);  } catch(e) {}
      try { if (map.getSource(srcId))   map.removeSource(srcId);   } catch(e) {}

      try {
        map.addSource(srcId, {
          type: 'geojson',
          lineMetrics: !!lineGradientExpression, // only enable when we have gradient data
          data: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: valid }
          }
        });
        routeSources.push(srcId);
      } catch(e) {
        postRN({ type: 'map_error', msg: 'addSource error: ' + String(e) });
        continue;
      }

      // 2. Under-Casing Layer (dark border beneath route)
      try {
        map.addLayer({
          id: casingId,
          type: 'line',
          source: srcId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#020617',
            'line-width': route.selected ? 12 : 6,
            'line-opacity': route.selected ? 0.95 : 0.4
          }
        });
        routeLayers.push(casingId);
      } catch(e) {}

      // 3. Ambient Glow Halo for selected route (uses solid color, not gradient)
      if (route.selected) {
        try {
          const glowColor = gTemps ? '#F59E0B' : (route.color || '#10B981');
          map.addLayer({
            id: glowId,
            type: 'line',
            source: srcId,
            paint: {
              'line-color': glowColor,
              'line-width': 28,
              'line-opacity': 0.22,
              'line-blur': 10
            }
          });
          routeLayers.push(glowId);
        } catch(e) {}
      }

      // 4. Primary Route Line — thermal gradient if available, solid color otherwise
      try {
        const linePaint = {
          'line-width': route.selected ? 8 : 4,
          'line-opacity': route.selected ? 1.0 : 0.50
        };

        if (lineGradientExpression) {
          linePaint['line-gradient'] = lineGradientExpression;
        } else {
          linePaint['line-color'] = route.color || '#10B981';
        }

        map.addLayer({
          id: lineId,
          type: 'line',
          source: srcId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: linePaint
        });
        routeLayers.push(lineId);
      } catch(e) {
        postRN({ type: 'map_error', msg: 'addLayer line error: ' + String(e) });
      }

      // 5. Directional Flow Chevrons (▶ ▶ ▶)
      try {
        map.addLayer({
          id: arrowId,
          type: 'symbol',
          source: srcId,
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': route.selected ? 55 : 90,
            'icon-image': 'nav-chevron',
            'icon-size': route.selected ? 0.55 : 0.38,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-rotation-alignment': 'map',
            'icon-keep-upright': false
          },
          paint: {
            'icon-opacity': route.selected ? 0.9 : 0.30
          }
        });
        routeLayers.push(arrowId);
      } catch(e) {}

      // 6. Turn Decision Point Waypoint Nodes (for active route)
      if (route.selected) {
        const turns = calculateTurns(valid);
        if (turns.length > 0) {
          try {
            map.addSource(turnSrcId, {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: turns }
            });
            routeSources.push(turnSrcId);

            map.addLayer({
              id: turnId,
              type: 'circle',
              source: turnSrcId,
              paint: {
                'circle-radius': 5,
                'circle-color': '#FFFFFF',
                'circle-stroke-color': route.color || '#10B981',
                'circle-stroke-width': 2.5,
                'circle-opacity': 0.95
              }
            });
            routeLayers.push(turnId);
          } catch(e) {}
        }
      }

      // 7. Temperature Label text along the selected route line (snapped perfectly on path)
      if (route.selected && gTemps && gTemps.length >= 2) {
        // Sample points along the route
        const MAX_BADGES = 8;
        const step = Math.max(1, Math.floor(gTemps.length / MAX_BADGES));
        const tempFeatures = [];
        
        for (let i = 0; i < gTemps.length; i += step) {
          const pt = gTemps[i];
          const lng = pt[0], lat = pt[1], tempC = pt[2];
          if (!isFinite(lng) || !isFinite(lat) || !isFinite(tempC)) continue;

          const tempRounded = Math.round(tempC);
          
          // Color based on temperature
          let tempColor;
          if (tempC <= 24) {
            tempColor = '#10B981'; // Cool Green
          } else if (tempC <= 28) {
            tempColor = '#38BDF8'; // Mild Blue
          } else if (tempC <= 33) {
            tempColor = '#F59E0B'; // Warm Amber
          } else {
            tempColor = '#EF4444'; // Hot Red
          }

          tempFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [lng, lat]
            },
            properties: {
              tempText: tempRounded + '°',
              tempColor: tempColor
            }
          });
        }

        const tempSrcId = 'temp-src-' + route.id;
        const tempLayerId = 'temp-lbl-' + route.id;

        try {
          map.addSource(tempSrcId, {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: tempFeatures
            }
          });
          routeSources.push(tempSrcId);

          map.addLayer({
            id: tempLayerId,
            type: 'symbol',
            source: tempSrcId,
            layout: {
              'text-field': ['get', 'tempText'],
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-size': 11,
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              'text-anchor': 'center',
              'text-offset': [0, 0]
            },
            paint: {
              'text-color': ['get', 'tempColor'],
              'text-halo-color': '#020617', // Dark halo to make it stand out beautifully on the line
              'text-halo-width': 2.5,
              'text-halo-blur': 0.5
            }
          });
          routeLayers.push(tempLayerId);
        } catch(e) {
          postRN({ type: 'map_error', msg: 'temp symbol layer error: ' + String(e) });
        }
      }

      // Click listener for route selection
      try {
        map.on('click', lineId, function(e) {
          if (e && e.originalEvent) e.originalEvent.stopPropagation();
          postRN({ type: 'route_click', routeId: route.id });
        });
      } catch(e) {}
    }

    if (hasBounds) {
      try {
        map.fitBounds(bounds, {
          padding: { top: 110, bottom: 220, left: 40, right: 40 },
          maxZoom: 16,
          duration: 850
        });
      } catch(e) {}
    }
  }

  let currentPayload = null;

  function applyPayload(p) {
    if (!p) return;
    currentPayload = p;
    if (typeof p.soloMode === 'boolean') {
      isSolo = p.soloMode;
    }
    if (p.origin) updateMarker('origin', p.origin.lng, p.origin.lat);
    if (p.dest)   updateMarker('destination', p.dest.lng, p.dest.lat);

    if (Array.isArray(p.routes) && p.routes.length > 0) {
      drawRoutes(p.routes, isSolo);
    } else {
      clearRoutes();
      if (p.origin && p.dest && isFinite(p.origin.lng) && isFinite(p.origin.lat) && isFinite(p.dest.lng) && isFinite(p.dest.lat)) {
        try {
          const b = new mapboxgl.LngLatBounds();
          b.extend([p.origin.lng, p.origin.lat]);
          b.extend([p.dest.lng, p.dest.lat]);
          map.fitBounds(b, {
            padding: { top: 110, bottom: 220, left: 40, right: 40 },
            maxZoom: 15,
            duration: 700
          });
        } catch(e) {}
      }
    }

    // Hint banner
    activePinMode = p.pinMode || null;
    const hintEl = document.getElementById('hint');
    if (hintEl) {
      if (activePinMode === 'origin') {
        hintEl.style.display = 'block';
        hintEl.textContent = '📍 Tap anywhere on map to set START Point';
      } else if (activePinMode === 'destination') {
        hintEl.style.display = 'block';
        hintEl.textContent = '🎯 Tap anywhere on map to set DESTINATION Point';
      } else {
        hintEl.style.display = 'none';
      }
    }
  }

  map.on('load', function() {
    isMapReady = true;
    registerArrowIcon();

    // Add 3D building extrusions layer for immersive 3D view
    try {
      const layers = map.getStyle().layers;
      let labelLayerId;
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].type === 'symbol' && layers[i].layout && layers[i].layout['text-field']) {
          labelLayerId = layers[i].id;
          break;
        }
      }
      map.addLayer({
        id: '3d-buildings',
        source: 'composite',
        'source-layer': 'building',
        filter: ['==', 'extrude', 'true'],
        type: 'fill-extrusion',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#1e293b',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'min_height'],
          'fill-extrusion-opacity': 0.6
        }
      }, labelLayerId);
    } catch(e) {}

    postRN({ type: 'map_ready' });
    init3DLayer();
    if (pendingPayload) {
      applyPayload(pendingPayload);
      pendingPayload = null;
    }
  });

  map.on('click', function(e) {
    if (activePinMode) {
      postRN({ type: 'map_click', lat: e.lngLat.lat, lng: e.lngLat.lng, mode: activePinMode });
    } else {
      postRN({ type: 'map_tap_canvas' });
    }
  });

  // Global methods accessible from React Native
  window._applyPayload = function(p) {
    if (isMapReady) {
      applyPayload(p);
    } else {
      pendingPayload = p;
    }
  };

  // ── 🎨 PROCEDURAL LOW-POLY 3D MODELS (MAYA, BIKE, CAR) ──
  let three3DLayer = null;
  let currentNavData = null;
  let animTime = 0;

  function buildMaya3D() {
    const g = new THREE.Group();
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xFFD1A4 });
    const hairMat = new THREE.MeshLambertMaterial({ color: 0x3D1E0B });
    const jacketMat = new THREE.MeshLambertMaterial({ color: 0xEC4899 });
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x1E293B });
    const shoesMat = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });
    const bagMat = new THREE.MeshLambertMaterial({ color: 0x059669 });

    const body = new THREE.Group();
    g.add(body);
    g.body = body;

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.62, 0.28), jacketMat);
    torso.position.y = 1.15;
    body.add(torso);

    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.18), bagMat);
    bag.position.set(0, 1.15, -0.2);
    body.add(bag);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), skinMat);
    head.position.y = 1.62;
    body.add(head);

    const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.38), hairMat);
    hairTop.position.set(0, 1.74, 0.02);
    body.add(hairTop);

    const ponytail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.16), hairMat);
    ponytail.position.set(0, 1.58, -0.24);
    body.add(ponytail);

    const armLPivot = new THREE.Group();
    armLPivot.position.set(-0.32, 1.38, 0);
    const armLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.48, 0.14), jacketMat);
    armLMesh.position.y = -0.24;
    armLPivot.add(armLMesh);
    body.add(armLPivot);
    g.armL = armLPivot;

    const armRPivot = new THREE.Group();
    armRPivot.position.set(0.32, 1.38, 0);
    const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.48, 0.14), jacketMat);
    armRMesh.position.y = -0.24;
    armRPivot.add(armRMesh);
    body.add(armRPivot);
    g.armR = armRPivot;

    const legLPivot = new THREE.Group();
    legLPivot.position.set(-0.15, 0.82, 0);
    const legLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), pantsMat);
    legLMesh.position.y = -0.3;
    const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.28), shoesMat);
    shoeL.position.set(0, -0.6, 0.05);
    legLPivot.add(legLMesh);
    legLPivot.add(shoeL);
    g.add(legLPivot);
    g.legL = legLPivot;

    const legRPivot = new THREE.Group();
    legRPivot.position.set(0.15, 0.82, 0);
    const legRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), pantsMat);
    legRMesh.position.y = -0.3;
    const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.28), shoesMat);
    shoeR.position.set(0, -0.6, 0.05);
    legRPivot.add(legRMesh);
    legRPivot.add(shoeR);
    g.add(legRPivot);
    g.legR = legRPivot;

    return g;
  }

  function buildBike3D() {
    const g = new THREE.Group();
    const frameMat = new THREE.MeshLambertMaterial({ color: 0xF59E0B });
    const metalMat = new THREE.MeshLambertMaterial({ color: 0xCBD5E1 });
    const tireMat = new THREE.MeshLambertMaterial({ color: 0x0F172A });

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 1.1), frameMat);
    frame.position.set(0, 0.7, 0);
    g.add(frame);

    const handlebar = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.08), metalMat);
    handlebar.position.set(0, 1.05, 0.45);
    g.add(handlebar);

    const wheelF = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 10), tireMat);
    wheelF.rotation.z = Math.PI / 2;
    wheelF.position.set(0, 0.4, 0.6);
    g.add(wheelF);
    g.wheelF = wheelF;

    const wheelR = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 10), tireMat);
    wheelR.rotation.z = Math.PI / 2;
    wheelR.position.set(0, 0.4, -0.6);
    g.add(wheelR);
    g.wheelR = wheelR;

    const pedals = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1), metalMat);
    pedals.position.set(0, 0.35, 0);
    g.add(pedals);
    g.pedals = pedals;

    const rider = buildMaya3D();
    rider.scale.set(0.8, 0.8, 0.8);
    rider.position.set(0, 0.35, -0.12);
    g.add(rider);

    return g;
  }

  function buildCar3D() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x0284C7 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x0F172A });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x38BDF8, transparent: true, opacity: 0.75 });
    const tireMat = new THREE.MeshLambertMaterial({ color: 0x1E293B });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xFEF08A });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.32, 2.1), bodyMat);
    chassis.position.set(0, 0.4, 0);
    g.add(chassis);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.38, 1.05), glassMat);
    cabin.position.set(0, 0.72, -0.15);
    g.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.08, 0.9), roofMat);
    roof.position.set(0, 0.94, -0.15);
    g.add(roof);

    const lightL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.08), lightMat);
    lightL.position.set(-0.4, 0.42, 1.05);
    const lightR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.08), lightMat);
    lightR.position.set(0.4, 0.42, 1.05);
    g.add(lightL);
    g.add(lightR);

    function makeWheel(x, z) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 10), tireMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.26, z);
      g.add(w);
      return w;
    }

    g.wheelFL = makeWheel(-0.6, 0.6);
    g.wheelFR = makeWheel(0.6, 0.6);
    g.wheelRL = makeWheel(-0.6, -0.6);
    g.wheelRR = makeWheel(0.6, -0.6);

    return g;
  }

  function buildAura3D() {
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0x10B981,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.35, 20), auraMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    return ring;
  }

  function init3DLayer() {
    if (three3DLayer || !window.THREE) return;

    three3DLayer = {
      id: 'custom-3d-avatar-layer',
      type: 'custom',
      renderingMode: '3d',
      onAdd: function (mapInstance, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();

        const amb = new THREE.AmbientLight(0xffffff, 0.9);
        this.scene.add(amb);

        const dir = new THREE.DirectionalLight(0xffffff, 0.95);
        dir.position.set(40, 60, 80).normalize();
        this.scene.add(dir);

        this.avatarRoot = new THREE.Group();
        this.scene.add(this.avatarRoot);

        this.maya = buildMaya3D();
        this.avatarRoot.add(this.maya);

        this.bike = buildBike3D();
        this.avatarRoot.add(this.bike);

        this.car = buildCar3D();
        this.avatarRoot.add(this.car);

        this.aura = buildAura3D();
        this.avatarRoot.add(this.aura);

        this.map = mapInstance;
        this.renderer = new THREE.WebGLRenderer({
          canvas: mapInstance.getCanvas(),
          context: gl,
          antialias: true,
        });
        this.renderer.autoClear = false;
      },
      render: function (gl, matrix) {
        if (!currentNavData) return;

        const lng = currentNavData.lng;
        const lat = currentNavData.lat;
        const bearing = currentNavData.bearing || 0;
        const mode = (currentNavData.mode || 'walking').toLowerCase();

        const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], 0);
        const scale = coord.meterInMercatorCoordinateUnits() * 4.8;

        const rotX = Math.PI / 2;
        const rotY = -(bearing * Math.PI) / 180;

        const m = new THREE.Matrix4().fromArray(matrix);
        const l = new THREE.Matrix4()
          .makeTranslation(coord.x, coord.y, coord.z)
          .scale(new THREE.Vector3(scale, -scale, scale))
          .multiply(new THREE.Matrix4().makeRotationX(rotX))
          .multiply(new THREE.Matrix4().makeRotationY(rotY));

        this.camera.projectionMatrix = m.multiply(l);

        const isDrive = mode === 'driving' || mode === 'car';
        const isBike = mode === 'biking' || mode === 'bicycle' || mode === 'bike';
        const isRun = mode === 'running' || mode === 'run';
        const isWalk = !isDrive && !isBike;

        this.car.visible = isDrive;
        this.bike.visible = isBike;
        this.maya.visible = isWalk;

        animTime += 0.06;

        if (isWalk) {
          const spd = isRun ? 12 : 7;
          const swing = Math.sin(animTime * spd) * (isRun ? 0.85 : 0.55);
          if (this.maya.legL) this.maya.legL.rotation.x = swing;
          if (this.maya.legR) this.maya.legR.rotation.x = -swing;
          if (this.maya.armL) this.maya.armL.rotation.x = -swing;
          if (this.maya.armR) this.maya.armR.rotation.x = swing;
          if (this.maya.body) this.maya.body.position.y = Math.abs(Math.sin(animTime * spd)) * 0.12;
        }

        if (isBike) {
          const wheelSpin = animTime * 14;
          if (this.bike.wheelF) this.bike.wheelF.rotation.x = wheelSpin;
          if (this.bike.wheelR) this.bike.wheelR.rotation.x = wheelSpin;
          if (this.bike.pedals) this.bike.pedals.rotation.x = wheelSpin;
        }

        if (isDrive) {
          const wheelSpin = animTime * 18;
          if (this.car.wheelFL) this.car.wheelFL.rotation.x = wheelSpin;
          if (this.car.wheelFR) this.car.wheelFR.rotation.x = wheelSpin;
          if (this.car.wheelRL) this.car.wheelRL.rotation.x = wheelSpin;
          if (this.car.wheelRR) this.car.wheelRR.rotation.x = wheelSpin;
        }

        if (this.aura) {
          const auraScale = 1.0 + Math.sin(animTime * 4) * 0.15;
          this.aura.scale.set(auraScale, 1, auraScale);
        }

        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
      }
    };

    try {
      map.addLayer(three3DLayer);
    } catch(e) {}
  }

  // 3D Avatars fallback for transport modes (Walking, Running, Biking, Driving)
  function getAvatarSvg(mode) {
    var m = (mode || 'walking').toLowerCase();
    if (m === 'biking' || m === 'bicycling' || m === 'bike') {
      return '<div style="width:52px;height:52px;position:relative;display:flex;align-items:center;justify-content:center;">' +
        '<div style="position:absolute;width:44px;height:44px;border-radius:50%;background:rgba(245,158,11,0.25);border:2px solid #F59E0B;box-shadow:0 0 16px rgba(245,158,11,0.6);"></div>' +
        '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" style="z-index:2;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.5));">' +
        '<polygon points="20,2 25,9 15,9" fill="#F59E0B"/>' +
        '<circle cx="13" cy="26" r="5" stroke="#38BDF8" stroke-width="2" fill="#0F172A"/>' +
        '<circle cx="27" cy="26" r="5" stroke="#38BDF8" stroke-width="2" fill="#0F172A"/>' +
        '<path d="M13 26l7-9 7 9M20 17h5M20 17l-3-5" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="17" cy="9" r="3" fill="#F59E0B"/>' +
        '</svg></div>';
    }
    if (m === 'driving' || m === 'car' || m === 'drive') {
      return '<div style="width:56px;height:56px;position:relative;display:flex;align-items:center;justify-content:center;">' +
        '<div style="position:absolute;top:-8px;width:0;height:0;border-left:14px solid transparent;border-right:14px solid transparent;border-bottom:28px solid rgba(254,240,138,0.45);filter:blur(2px);"></div>' +
        '<div style="position:absolute;width:46px;height:46px;border-radius:50%;background:rgba(239,68,68,0.22);border:2px solid #EF4444;box-shadow:0 0 18px rgba(239,68,68,0.6);"></div>' +
        '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" style="z-index:2;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));">' +
        '<polygon points="22,2 27,9 17,9" fill="#FDE047"/>' +
        '<rect x="15" y="10" width="14" height="26" rx="5" fill="#EF4444" stroke="#FFFFFF" stroke-width="2"/>' +
        '<rect x="17" y="16" width="10" height="9" rx="2" fill="#0F172A" stroke="#38BDF8" stroke-width="1"/>' +
        '</svg></div>';
    }
    if (m === 'running' || m === 'run') {
      return '<div style="width:50px;height:50px;position:relative;display:flex;align-items:center;justify-content:center;">' +
        '<div style="position:absolute;width:42px;height:42px;border-radius:50%;background:rgba(56,189,248,0.25);border:2px solid #38BDF8;box-shadow:0 0 16px rgba(56,189,248,0.6);"></div>' +
        '<svg width="38" height="38" viewBox="0 0 38 38" fill="none" style="z-index:2;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.5));">' +
        '<polygon points="19,2 24,9 14,9" fill="#38BDF8"/>' +
        '<circle cx="21" cy="11" r="3.5" fill="#38BDF8"/>' +
        '<path d="M21 15l-4 7m0 0l-4 4m4-4l5 4m-5-4l-5-2m5 2l5-3" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>' +
        '</svg></div>';
    }
    // Default Walking Avatar
    return '<div style="width:50px;height:50px;position:relative;display:flex;align-items:center;justify-content:center;">' +
      '<div style="position:absolute;width:42px;height:42px;border-radius:50%;background:rgba(236,72,153,0.25);border:2px solid #EC4899;box-shadow:0 0 16px rgba(236,72,153,0.6);"></div>' +
      '<svg width="38" height="38" viewBox="0 0 38 38" fill="none" style="z-index:2;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.5));">' +
      '<polygon points="19,2 24,9 14,9" fill="#EC4899"/>' +
      '<circle cx="19" cy="11" r="3.5" fill="#F472B6"/>' +
      '<path d="M19 15v9m0 0l-4 6m4-6l4 6m-4-6l-4-3m4 3l4-3" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>' +
      '</svg></div>';
  }

  let navMarker = null;

  window._updateNavPosition = function(lat, lng, bearing, mode, followCamera) {
    if (!isFinite(lat) || !isFinite(lng)) return;
    
    currentNavData = { lat: lat, lng: lng, bearing: bearing || 0, mode: mode };

    if (!three3DLayer) {
      init3DLayer();
    }
    map.triggerRepaint();

    if (!navMarker) {
      const el = document.createElement('div');
      el.id = 'nav-avatar-marker';
      el.style.width = '56px';
      el.style.height = '56px';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.pointerEvents = 'none';
      navMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      navMarker.setLngLat([lng, lat]);
    }

    const markerEl = document.getElementById('nav-avatar-marker');
    if (markerEl) {
      markerEl.innerHTML = getAvatarSvg(mode);
      const rot = isFinite(bearing) ? bearing : 0;
      markerEl.style.transform = 'rotate(' + rot + 'deg)';
      markerEl.style.transition = 'transform 0.3s ease-out';
    }

    if (followCamera) {
      try {
        map.easeTo({
          center: [lng, lat],
          bearing: isFinite(bearing) ? bearing : map.getBearing(),
          pitch: 54,
          zoom: 17.5,
          duration: 400
        });
      } catch(e) {}
    }
  };

  window._clearNavPosition = function() {
    currentNavData = null;
    if (navMarker) {
      try { navMarker.remove(); } catch(e) {}
      navMarker = null;
    }
    map.triggerRepaint();
  };

  let activeNavAudio = null;
  window._speakText = function(text) {
    if (!text || typeof text !== 'string') return;
    if (activeNavAudio) {
      try { activeNavAudio.pause(); } catch(e) {}
      activeNavAudio = null;
    }
    try {
      const url = 'https://translate.google.com/translate_tts?ie=UTF-8&q=' + encodeURIComponent(text) + '&tl=en&client=tw-ob';
      activeNavAudio = new Audio(url);
      activeNavAudio.play().catch(function(e){});
    } catch(e) {}
  };

  let watchGeoId = null;
  window._startGPSWatch = function() {
    if (watchGeoId) return;
    if (navigator && navigator.geolocation) {
      watchGeoId = navigator.geolocation.watchPosition(
        function(pos) {
          if (pos && pos.coords) {
            postRN({
              type: 'gps_update',
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              speed: pos.coords.speed || 0,
              heading: pos.coords.heading || 0
            });
          }
        },
        function(err) {
          postRN({ type: 'gps_error', msg: err ? err.message : 'GPS Error' });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
      );
    }
  };

  window._stopGPSWatch = function() {
    if (watchGeoId && navigator && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchGeoId);
      watchGeoId = null;
    }
  };

  window._getCurrentLocation = function() {
    if (navigator && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function(pos) {
          if (pos && pos.coords) {
            postRN({
              type: 'current_location_result',
              lat: pos.coords.latitude,
              lng: pos.coords.longitude
            });
          }
        },
        function(err) {
          postRN({ type: 'current_location_error', msg: err ? err.message : 'GPS location unavailable' });
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 3000 }
      );
    } else {
      postRN({ type: 'current_location_error', msg: 'Geolocation unavailable' });
    }
  };

  window._flyToLocation = function(lat, lng, zoom) {
    if (!map) return;
    map.flyTo({
      center: [lng, lat],
      zoom: zoom || 16.5,
      pitch: 45,
      essential: true,
      duration: 1800
    });
  };

  window._toggle3D = function() {
    is3D = !is3D;
    map.easeTo({
      pitch: is3D ? 52 : 0,
      bearing: is3D ? -20 : 0,
      duration: 1000
    });
    return is3D;
  };

  window._toggleSolo = function() {
    isSolo = !isSolo;
    if (currentPayload && Array.isArray(currentPayload.routes)) {
      drawRoutes(currentPayload.routes, isSolo);
    }
    return isSolo;
  };

  window._recenter = function() {
    if (currentPayload && Array.isArray(currentPayload.routes) && currentPayload.routes.length > 0) {
      const b = new mapboxgl.LngLatBounds();
      let hasB = false;
      
      const sel = currentPayload.routes.find(function(r) { return r.selected; });
      const targetRoutes = (sel && Array.isArray(sel.coords) && sel.coords.length > 0) ? [sel] : currentPayload.routes;

      targetRoutes.forEach(function(r) {
        if (Array.isArray(r.coords)) {
          r.coords.forEach(function(c) {
            if (Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1])) {
              b.extend(c);
              hasB = true;
            }
          });
        }
      });

      if (!hasB && currentPayload.origin && currentPayload.dest) {
        b.extend([currentPayload.origin.lng, currentPayload.origin.lat]);
        b.extend([currentPayload.dest.lng, currentPayload.dest.lat]);
        hasB = true;
      }

      if (hasB) {
        map.fitBounds(b, {
          padding: { top: 120, bottom: 240, left: 40, right: 40 },
          maxZoom: 16,
          duration: 900
        });
      }
    }
  };

  window._resetNorth = function() {
    map.easeTo({ bearing: 0, pitch: 0, duration: 600 });
  };

  window._updateOriginHeading = function(heading) {
    const arrow = document.getElementById('origin-heading-arrow');
    if (arrow) {
      if (heading !== null && heading !== undefined) {
        arrow.style.display = 'block';
        // Need to compensate for map's current bearing so arrow points correctly relative to north
        const mapBearing = map.getBearing();
        const adjusted = heading - mapBearing;
        arrow.style.transform = 'rotate(' + adjusted + 'deg)';
      } else {
        arrow.style.display = 'none';
      }
    }
  };

  // Add event listener to update arrow when map rotates
  map.on('rotate', function() {
    if (window.__lastHeading !== undefined && window.__lastHeading !== null) {
       window._updateOriginHeading(window.__lastHeading);
    }
  });

  const originalUpdate = window._updateOriginHeading;
  window._updateOriginHeading = function(heading) {
     window.__lastHeading = heading;
     originalUpdate(heading);
  };

})();
</script>
</body>
</html>`;
}

export const MobileMap: React.FC<MobileMapProps> = ({
  missionResponse,
  originCoord,
  destinationCoord,
  selectedRouteId,
  pinMode = null,
  mapStyle = 'dark',
  navPosition,
  navSpeakerText,
  onGpsUpdate,
  onGpsError,
  onCurrentLocation,
  requestCurrentLocationSignal,
  flyToCoord,
  onSelectRoute,
  onMapClick,
  onPinMoved,
  onMapCanvasTap,
  userHeading,
}) => {
  const webViewRef = useRef<WebView>(null);
  const [is3DMode, setIs3DMode] = useState(false);
  const [isSoloMode, setIsSoloMode] = useState(false);

  const mapboxStyle =
    mapStyle === 'satellite' ? 'mapbox://styles/mapbox/satellite-streets-v12' :
    mapStyle === 'outdoors'  ? 'mapbox://styles/mapbox/outdoors-v12' :
    mapStyle === 'light'     ? 'mapbox://styles/mapbox/light-v11' :
    mapStyle === 'dark'      ? 'mapbox://styles/mapbox/dark-v11' :
                               'mapbox://styles/mapbox/streets-v12';

  const html = useMemo(() => buildMapHtml(MAPBOX_ACCESS_TOKEN, mapboxStyle), [mapboxStyle]);

  const latestRef = useRef({ missionResponse, originCoord, destinationCoord, selectedRouteId, pinMode, isSoloMode });
  useEffect(() => {
    latestRef.current = { missionResponse, originCoord, destinationCoord, selectedRouteId, pinMode, isSoloMode };
  });

  const mapReadyRef = useRef(false);

  const COLOR_PALETTE = ['#10B981', '#38BDF8', '#A855F7', '#F59E0B', '#EC4899'];

  function buildPayload(
    resp: MissionResponse | null,
    orig: Coordinate,
    dst: Coordinate,
    selRoute: string,
    pm: PinMode,
    solo: boolean
  ) {
    const routes = (resp?.route_options || []).map((r, idx) => ({
      id:             r.id,
      selected:       r.id === selRoute,
      recommended:    r.is_recommended,
      coords:         r.coordinates || [],
      geometry_temps: r.geometry_temps || [],
      color:          r.id === selRoute ? '#10B981' : COLOR_PALETTE[(idx + 1) % COLOR_PALETTE.length],
    }));
    return {
      origin:   { lat: orig.lat, lng: orig.lng },
      dest:     { lat: dst.lat,  lng: dst.lng },
      routes,
      pinMode:  pm,
      soloMode: solo,
    };
  }

  function inject(payload: object) {
    const js = `window._applyPayload && window._applyPayload(${JSON.stringify(payload)}); true;`;
    webViewRef.current?.injectJavaScript(js);
  }

  useEffect(() => {
    inject(buildPayload(missionResponse, originCoord, destinationCoord, selectedRouteId, pinMode, isSoloMode));
  }, [originCoord, destinationCoord, missionResponse, selectedRouteId, pinMode, isSoloMode]);

  useEffect(() => {
    if (navPosition) {
      if (navPosition.mode === 'real_watch') {
        webViewRef.current?.injectJavaScript('window._startGPSWatch && window._startGPSWatch(); true;');
      } else {
        const { lat, lng, bearing = 0, mode = 'walking', followCamera = true } = navPosition;
        const js = `window._updateNavPosition && window._updateNavPosition(${lat}, ${lng}, ${bearing}, '${mode}', ${followCamera}); true;`;
        webViewRef.current?.injectJavaScript(js);
      }
    } else {
      webViewRef.current?.injectJavaScript('window._clearNavPosition && window._clearNavPosition(); true;');
      webViewRef.current?.injectJavaScript('window._stopGPSWatch && window._stopGPSWatch(); true;');
    }
  }, [navPosition]);

  useEffect(() => {
    if (requestCurrentLocationSignal && requestCurrentLocationSignal > 0) {
      webViewRef.current?.injectJavaScript('window._getCurrentLocation && window._getCurrentLocation(); true;');
    }
  }, [requestCurrentLocationSignal]);

  useEffect(() => {
    if (flyToCoord) {
      const js = `window._flyToLocation && window._flyToLocation(${flyToCoord.lat}, ${flyToCoord.lng}, 16.5); true;`;
      webViewRef.current?.injectJavaScript(js);
    }
  }, [flyToCoord]);

  useEffect(() => {
    if (navSpeakerText) {
      const js = `window._speakText && window._speakText(${JSON.stringify(navSpeakerText)}); true;`;
      webViewRef.current?.injectJavaScript(js);
    }
  }, [navSpeakerText]);

  useEffect(() => {
    if (userHeading !== undefined && userHeading !== null) {
      const js = `
        if (window._updateOriginHeading) {
          window._updateOriginHeading(${userHeading});
        }
        true;
      `;
      webViewRef.current?.injectJavaScript(js);
    } else {
      const js = `
        if (window._updateOriginHeading) {
          window._updateOriginHeading(null);
        }
        true;
      `;
      webViewRef.current?.injectJavaScript(js);
    }
  }, [userHeading]);

  const handleToggle3D = () => {
    setIs3DMode((prev) => !prev);
    webViewRef.current?.injectJavaScript('window._toggle3D && window._toggle3D(); true;');
  };

  const handleToggleSolo = () => {
    setIsSoloMode((prev) => {
      const nextVal = !prev;
      return nextVal;
    });
    webViewRef.current?.injectJavaScript('window._toggleSolo && window._toggleSolo(); true;');
  };

  const handleRecenter = () => {
    webViewRef.current?.injectJavaScript('window._recenter && window._recenter(); true;');
  };

  const handleResetNorth = () => {
    webViewRef.current?.injectJavaScript('window._resetNorth && window._resetNorth(); true;');
  };

  const hasActiveRoutes = Boolean(missionResponse?.route_options?.length);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webView}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled={true}
        startInLoadingState={false}
        scalesPageToFit={false}
        mixedContentMode="always"
        scrollEnabled={false}
        onLoad={() => {
          mapReadyRef.current = false;
          const { missionResponse: mr, originCoord: oc, destinationCoord: dc, selectedRouteId: sr, pinMode: pm, isSoloMode: sm } = latestRef.current;
          inject(buildPayload(mr, oc, dc, sr, pm, sm));
        }}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === 'map_ready') {
              mapReadyRef.current = true;
            } else if (data.type === 'map_error') {
              console.warn('[MobileMap WebView error]', data.msg);
            } else if (data.type === 'map_click' && onMapClick) {
              onMapClick(data.lat, data.lng, data.mode);
            } else if (data.type === 'pin_moved' && onPinMoved) {
              onPinMoved(data.pin, data.lat, data.lng);
            } else if (data.type === 'route_click' && onSelectRoute) {
              onSelectRoute(data.routeId);
            } else if (data.type === 'map_tap_canvas' && onMapCanvasTap) {
              onMapCanvasTap();
            } else if (data.type === 'gps_update' && onGpsUpdate) {
              onGpsUpdate(data.lat, data.lng, data.speed, data.heading);
            } else if (data.type === 'gps_error' && onGpsError) {
              onGpsError(data.msg);
            } else if (data.type === 'current_location_result' && onCurrentLocation) {
              onCurrentLocation(data.lat, data.lng);
            }
          } catch (e) {}
        }}
      />

      {/* ── Professional Floating GIS & Navigation Controls ── */}
      <View style={styles.gisToolbox}>
        {/* Solo Route Focus Mode */}
        {hasActiveRoutes && (
          <TouchableOpacity
            style={[styles.toolBtn, isSoloMode && styles.toolBtnActive]}
            onPress={handleToggleSolo}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name={isSoloMode ? 'eye' : 'eye-outline'}
              size={18}
              color={isSoloMode ? '#10B981' : '#94a3b8'}
            />
            <Text style={[styles.toolBtnTxt, isSoloMode && styles.toolBtnTxtActive]}>
              {isSoloMode ? 'Solo' : 'All'}
            </Text>
          </TouchableOpacity>
        )}

        {/* 3D Buildings & Pitch Toggle */}
        <TouchableOpacity
          style={[styles.toolBtn, is3DMode && styles.toolBtnActive]}
          onPress={handleToggle3D}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons
            name="cube-outline"
            size={18}
            color={is3DMode ? '#38BDF8' : '#94a3b8'}
          />
          <Text style={[styles.toolBtnTxt, is3DMode && { color: '#38BDF8' }]}>
            {is3DMode ? '3D' : '2D'}
          </Text>
        </TouchableOpacity>

        {/* Recenter & Fit Route */}
        {hasActiveRoutes && (
          <TouchableOpacity style={styles.toolBtn} onPress={handleRecenter} activeOpacity={0.8}>
            <Ionicons name="scan-outline" size={17} color="#94a3b8" />
          </TouchableOpacity>
        )}

        {/* True North Compass */}
        <TouchableOpacity style={styles.toolBtn} onPress={handleResetNorth} activeOpacity={0.8}>
          <FontAwesome5 name="compass" size={15} color="#94a3b8" />
        </TouchableOpacity>
      </View>


    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0f172a',
  },
  webView: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  gisToolbox: {
    position: 'absolute',
    right: 14,
    bottom: 160,
    flexDirection: 'column',
    gap: 8,
    zIndex: 20,
  },
  toolBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 5,
  },
  toolBtnActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderColor: '#10B981',
  },
  toolBtnTxt: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94a3b8',
    marginTop: -1,
  },
  toolBtnTxtActive: {
    color: '#10B981',
  },
  thermalLegendBar: {
    position: 'absolute',
    left: 14,
    top: 255,
    backgroundColor: 'rgba(12, 18, 16, 0.9)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    zIndex: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  thermalLegendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  thermalLegendTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  thermalGradientTrack: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  thermalSegment: {
    flex: 1,
  },
  thermalLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  thermalLabelTxt: {
    fontSize: 9,
    color: '#64748b',
    fontWeight: '600',
  },
});
