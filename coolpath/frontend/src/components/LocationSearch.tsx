import React, { useState, useRef, useEffect } from 'react';
import { getActiveBaseUrl } from '../services/api';

export interface GeoResult {
  display_name: string;
  lat: number;
  lng: number;
}

interface LocationSearchProps {
  label: string;
  value: string;           // Human-readable location name shown in the box
  onSelect: (result: GeoResult) => void;
  pinColor?: 'green' | 'red';
  disabled?: boolean;
}

const LocationSearch: React.FC<LocationSearchProps> = ({ label, value, onSelect, pinColor = 'green', disabled }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const baseUrl = await getActiveBaseUrl();
        const resp = await fetch(`${baseUrl}/api/geocode?q=${encodeURIComponent(q)}`);
        const data = await resp.json();
        setResults(data.results || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400); // 400ms debounce
  };

  const handleSelect = (r: GeoResult) => {
    setQuery('');
    setOpen(false);
    setResults([]);
    onSelect(r);
  };

  const dotColor = pinColor === 'green' ? '#10b981' : '#ef4444';

  return (
    <div className="form-group" ref={containerRef} style={{ position: 'relative' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          display: 'inline-block',
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0
        }} />
        {label}
      </label>

      {/* Selected location display */}
      {value && !query && (
        <div style={{
          padding: '8px 12px',
          background: '#f0fdf4',
          border: `1px solid ${dotColor}33`,
          borderRadius: '6px 6px 0 0',
          fontSize: '13px',
          color: '#166534',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {value}
        </div>
      )}

      <input
        type="text"
        placeholder={value ? 'Search to change location…' : 'Type a place name or address…'}
        value={query}
        onChange={handleChange}
        disabled={disabled}
        style={{
          borderRadius: value && !query ? '0 0 6px 6px' : '6px',
          borderTop: value && !query ? 'none' : undefined,
        }}
        onFocus={() => query.length >= 3 && setOpen(true)}
      />

      {loading && (
        <div style={{
          position: 'absolute',
          right: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: '12px',
          color: '#6b7280'
        }}>
          Searching…
        </div>
      )}

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'white',
          border: '1px solid #e5e7eb',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          boxShadow: '0 8px 20px -4px rgba(0,0,0,0.15)',
          zIndex: 1000,
          maxHeight: '220px',
          overflowY: 'auto'
        }}>
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => handleSelect(r)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 14px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                color: '#1e293b',
                borderBottom: i < results.length - 1 ? '1px solid #f1f5f9' : 'none',
                lineHeight: 1.4
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ marginRight: '6px' }}>📍</span>
              {r.display_name.length > 70 ? r.display_name.slice(0, 70) + '…' : r.display_name}
            </button>
          ))}
        </div>
      )}

      {open && results.length === 0 && !loading && query.length >= 3 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'white',
          border: '1px solid #e5e7eb',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          padding: '12px 14px',
          fontSize: '13px',
          color: '#6b7280',
          zIndex: 1000
        }}>
          No results found for "{query}"
        </div>
      )}
    </div>
  );
};

export default LocationSearch;
