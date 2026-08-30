import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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

const STYLE_URLS: Record<MapStyleType, string> = {
  streets: 'mapbox://styles/mapbox/streets-v12',
  dark: 'mapbox://styles/mapbox/dark-v11',
  light: 'mapbox://styles/mapbox/light-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  outdoors: 'mapbox://styles/mapbox/outdoors-v12',
};

function buildWebMapHtml(token: string, styleUrl: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.2.0/mapbox-gl.css" rel="stylesheet"/>
<script src="https://api.mapbox.com/mapbox-gl-js/v3.2.0/mapbox-gl.js"></script>
<style>
*{box-sizing:border-box}html,body,#map{width:100%;height:100%;margin:0;background:#0c1210;overflow:hidden}
.mapboxgl-ctrl-logo,.mapboxgl-ctrl-attrib{display:none!important}.mapboxgl-ctrl-bottom-right{right:14px;bottom:74px}
.pin{width:25px;height:25px;border:3px solid #fff;border-radius:50%;cursor:grab;box-shadow:0 4px 14px rgba(0,0,0,.5)}
.origin{background:#2dd9b8;box-shadow:0 0 0 6px rgba(45,217,184,.22),0 4px 14px rgba(0,0,0,.5)}
.destination{background:#e8895e;box-shadow:0 0 0 6px rgba(232,137,94,.22),0 4px 14px rgba(0,0,0,.5)}
.traveler{width:27px;height:27px;border:3px solid #fff;border-radius:50%;background:#38bdf8;box-shadow:0 0 0 7px rgba(56,189,248,.2)}
</style></head><body><div id="map"></div><script>
(() => {
  const SOURCE = 'coolpath-web-map';
  const send = (type, data = {}) => parent.postMessage({ source: SOURCE, type, ...data }, '*');
  mapboxgl.accessToken = ${JSON.stringify(token)};
  const map = new mapboxgl.Map({container:'map',style:${JSON.stringify(styleUrl)},center:[-73.9855,40.758],zoom:13,attributionControl:false});
  map.addControl(new mapboxgl.NavigationControl({showCompass:false}),'bottom-right');
  let originMarker, destinationMarker, travelerMarker, payload, ready=false, watchId;
  const routeLayerIds=[];
  const makePin = kind => { const el=document.createElement('div'); el.className='pin '+kind; return el; };
  const clearRoutes = () => { while(routeLayerIds.length){const id=routeLayerIds.pop();try{if(map.getLayer(id))map.removeLayer(id)}catch(e){}try{if(map.getSource(id))map.removeSource(id)}catch(e){}} };
  const setMarker = (current, kind, coord) => {
    if (!coord) { if(current) current.remove(); return null; }
    if (!current) {
      current = new mapboxgl.Marker({element:makePin(kind),draggable:true}).setLngLat([coord.lng,coord.lat]).addTo(map);
      current.on('dragend',()=>{const p=current.getLngLat();send('pin_moved',{pin:kind,lat:p.lat,lng:p.lng})});
    } else current.setLngLat([coord.lng,coord.lat]);
    return current;
  };
  const applyPayload = p => {
    payload=p;
    if(!ready)return;
    originMarker=setMarker(originMarker,'origin',p.origin);
    destinationMarker=setMarker(destinationMarker,'destination',p.dest);
    clearRoutes();
    (p.routes||[]).forEach((route,index)=>{
      if(!route.coords||route.coords.length<2)return;
      const id='route-'+index+'-'+String(route.id).replace(/[^a-z0-9_-]/gi,'');
      map.addSource(id,{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:route.coords}}});
      map.addLayer({id,type:'line',source:id,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':route.color||'#38bdf8','line-width':route.selected?7:4,'line-opacity':route.selected?1:.64}});
      map.on('click',id,()=>send('route_click',{routeId:route.id}));
      map.on('mouseenter',id,()=>map.getCanvas().style.cursor='pointer');
      map.on('mouseleave',id,()=>map.getCanvas().style.cursor='');
      routeLayerIds.push(id);
    });
    if ((p.routes||[]).length) {
      const coords=p.routes.flatMap(r=>r.coords||[]);
      if(coords.length){const bounds=coords.reduce((b,c)=>b.extend(c),new mapboxgl.LngLatBounds(coords[0],coords[0]));map.fitBounds(bounds,{padding:90,duration:800,maxZoom:15});}
    }
  };
  map.on('load',()=>{ready=true;send('map_ready');if(payload)applyPayload(payload)});
  map.on('error',e=>send('map_error',{msg:e?.error?.message||'Map failed to load'}));
  map.on('click',e=>{const mode=payload?.pinMode||null;if(mode)send('map_click',{lat:e.lngLat.lat,lng:e.lngLat.lng,mode});else send('map_tap_canvas')});
  const currentLocation = () => navigator.geolocation
    ? navigator.geolocation.getCurrentPosition(p=>send('current_location_result',{lat:p.coords.latitude,lng:p.coords.longitude}),e=>send('gps_error',{msg:e.message}),{enableHighAccuracy:true,timeout:12000})
    : send('gps_error',{msg:'Geolocation is unavailable in this browser'});
  addEventListener('message',event=>{
    const m=event.data;if(!m||m.source!=='coolpath-web-parent')return;
    if(m.type==='payload')applyPayload(m.payload);
    if(m.type==='fly')map.flyTo({center:[m.lng,m.lat],zoom:m.zoom||16,duration:800});
    if(m.type==='current-location')currentLocation();
    if(m.type==='recenter'&&payload?.origin)map.flyTo({center:[payload.origin.lng,payload.origin.lat],zoom:15,duration:700});
    if(m.type==='reset-north')map.easeTo({bearing:0,pitch:0,duration:500});
    if(m.type==='toggle-3d')map.easeTo({pitch:map.getPitch()>10?0:58,bearing:map.getPitch()>10?0:-18,duration:650});
    if(m.type==='nav'){
      if(!travelerMarker){const el=document.createElement('div');el.className='traveler';travelerMarker=new mapboxgl.Marker({element:el}).setLngLat([m.lng,m.lat]).addTo(map)}else travelerMarker.setLngLat([m.lng,m.lat]);
      if(m.followCamera)map.easeTo({center:[m.lng,m.lat],bearing:m.bearing||0,zoom:16.5,duration:500});
    }
    if(m.type==='clear-nav'&&travelerMarker){travelerMarker.remove();travelerMarker=null}
    if(m.type==='start-watch'&&navigator.geolocation&&!watchId)watchId=navigator.geolocation.watchPosition(p=>send('gps_update',{lat:p.coords.latitude,lng:p.coords.longitude,speed:p.coords.speed||0,heading:p.coords.heading||0}),e=>send('gps_error',{msg:e.message}),{enableHighAccuracy:true});
    if(m.type==='stop-watch'&&watchId){navigator.geolocation.clearWatch(watchId);watchId=null}
  });
})();
</script></body></html>`;
}

export const MobileMap: React.FC<MobileMapProps> = ({
  missionResponse,
  originCoord,
  destinationCoord,
  selectedRouteId,
  pinMode = null,
  mapStyle = 'dark',
  navPosition,
  requestCurrentLocationSignal,
  flyToCoord,
  onGpsUpdate,
  onGpsError,
  onCurrentLocation,
  onSelectRoute,
  onMapClick,
  onPinMoved,
  onMapCanvasTap,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [isSolo, setIsSolo] = useState(false);
  const html = useMemo(() => buildWebMapHtml(MAPBOX_ACCESS_TOKEN, STYLE_URLS[mapStyle]), [mapStyle]);

  const post = (message: object) => iframeRef.current?.contentWindow?.postMessage({ source: 'coolpath-web-parent', ...message }, '*');
  const routes = useMemo(() => (missionResponse?.route_options || [])
    .filter(route => !isSolo || route.id === selectedRouteId)
    .map((route, index) => ({
      id: route.id,
      selected: route.id === selectedRouteId,
      coords: route.coordinates || [],
      color: route.id === selectedRouteId ? '#2DD9B8' : ['#38BDF8', '#A855F7', '#F59E0B'][index % 3],
    })), [missionResponse, selectedRouteId, isSolo]);

  useEffect(() => {
    if (!loaded) return;
    post({ type: 'payload', payload: { origin: originCoord, dest: destinationCoord, routes, pinMode } });
  }, [loaded, originCoord, destinationCoord, routes, pinMode]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== 'coolpath-web-map') return;
      if (data.type === 'map_ready') setLoaded(true);
      else if (data.type === 'map_error') console.warn('[CoolPath web map]', data.msg);
      else if (data.type === 'map_click') onMapClick?.(data.lat, data.lng, data.mode);
      else if (data.type === 'pin_moved') onPinMoved?.(data.pin, data.lat, data.lng);
      else if (data.type === 'route_click') onSelectRoute?.(data.routeId);
      else if (data.type === 'map_tap_canvas') onMapCanvasTap?.();
      else if (data.type === 'gps_update') onGpsUpdate?.(data.lat, data.lng, data.speed, data.heading);
      else if (data.type === 'gps_error') onGpsError?.(data.msg);
      else if (data.type === 'current_location_result') onCurrentLocation?.(data.lat, data.lng);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onCurrentLocation, onGpsError, onGpsUpdate, onMapCanvasTap, onMapClick, onPinMoved, onSelectRoute]);

  useEffect(() => {
    if (requestCurrentLocationSignal) post({ type: 'current-location' });
  }, [requestCurrentLocationSignal]);

  useEffect(() => {
    if (flyToCoord) post({ type: 'fly', ...flyToCoord, zoom: 16.5 });
  }, [flyToCoord]);

  useEffect(() => {
    if (!navPosition) {
      post({ type: 'clear-nav' });
      post({ type: 'stop-watch' });
    } else if (navPosition.mode === 'real_watch') {
      post({ type: 'start-watch' });
    } else {
      post({ type: 'nav', ...navPosition });
    }
  }, [navPosition]);

  return (
    <View style={styles.container}>
      {React.createElement('iframe' as any, {
        key: mapStyle,
        ref: iframeRef,
        srcDoc: html,
        title: 'CoolPath interactive route map',
        allow: 'geolocation',
        onLoad: () => setLoaded(true),
        style: { width: '100%', height: '100%', border: 0, display: 'block' },
      })}
      <View style={styles.toolbox}>
        {!!missionResponse?.route_options?.length && (
          <TouchableOpacity style={[styles.toolButton, isSolo && styles.toolButtonActive]} onPress={() => setIsSolo(value => !value)}>
            <Ionicons name={isSolo ? 'eye' : 'eye-outline'} size={19} color={isSolo ? '#0c1210' : '#f3f0ea'} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.toolButton, is3D && styles.toolButtonActive]} onPress={() => { setIs3D(value => !value); post({ type: 'toggle-3d' }); }}>
          <MaterialCommunityIcons name="cube-outline" size={19} color={is3D ? '#0c1210' : '#f3f0ea'} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolButton} onPress={() => post({ type: 'recenter' })}>
          <Ionicons name="scan-outline" size={19} color="#f3f0ea" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolButton} onPress={() => post({ type: 'reset-north' })}>
          <Ionicons name="compass-outline" size={19} color="#f3f0ea" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c1210' },
  toolbox: { position: 'absolute', right: 14, top: 104, gap: 8 },
  toolButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,18,16,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(243,240,234,0.16)',
  },
  toolButtonActive: { backgroundColor: '#2DD9B8', borderColor: '#2DD9B8' },
});
