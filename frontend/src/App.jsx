import React, { useState, useEffect, useRef } from 'react';

// Helper: Convert base64 string to Blob for off-main-thread image decoding
function base64ToBlob(base64, mimeType = 'image/jpeg') {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

export default function App() {
  const [status, setStatus] = useState('idle'); // idle | starting | active | stopping | error
  const [errorMessage, setErrorMessage] = useState('');
  const [url, setUrl] = useState('https://news.ycombinator.com');
  const [isFocused, setIsFocused] = useState(false);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const lastMouseMoveRef = useRef(0);

  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Helper to draw monitor outline and text
  const drawIdleMonitor = (canvas) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // Background
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, 1280, 800);

    // Monitor Outer Frame
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 4;
    ctx.fillStyle = '#111827';
    const mw = 400;
    const mh = 260;
    const mx = 640 - mw / 2;
    const my = 360 - mh / 2;
    
    // Draw monitor bezel
    ctx.beginPath();
    ctx.roundRect(mx, my, mw, mh, 12);
    ctx.fill();
    ctx.stroke();

    // Monitor Screen (Inner)
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(mx + 10, my + 10, mw - 20, mh - 30, 8);
    ctx.fill();

    // Monitor Stand (Neck)
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(620, my + mh, 40, 40);

    // Monitor Base
    ctx.beginPath();
    ctx.moveTo(580, my + mh + 40);
    ctx.lineTo(700, my + mh + 40);
    ctx.lineTo(680, my + mh + 50);
    ctx.lineTo(600, my + mh + 50);
    ctx.closePath();
    ctx.fill();

    // Text: "Ready to connect"
    ctx.fillStyle = '#9ca3af';
    ctx.font = '20px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Ready to connect', 640, 560);
  };

  // Stop the browser and close WS
  const handleStop = async () => {
    if (status === 'stopping') return;
    setStatus('stopping');
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    try {
      const res = await fetch('http://localhost:3001/api/stop', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'stopped') {
        setStatus('idle');
        // Clear canvas
        const canvas = canvasRef.current;
        if (canvas) {
          drawIdleMonitor(canvas);
        }
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage('Failed to stop container: ' + err.message);
    }
  };

  // Start the browser container and connect WS
  const handleStart = async () => {
    if (status === 'starting' || status === 'active') return;
    setStatus('starting');
    setErrorMessage('');
    try {
      const res = await fetch('http://localhost:3001/api/start', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'ready') {
        connectWebSocket();
      } else {
        throw new Error(data.error || 'Server returned invalid start status');
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage('Failed to start container: ' + err.message);
    }
  };

  const connectWebSocket = () => {
    const ws = new WebSocket('ws://localhost:3001');
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('active');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'frame' && canvasRef.current) {
          const blob = base64ToBlob(msg.data);
          createImageBitmap(blob).then((imageBitmap) => {
            if (canvasRef.current) {
              const canvas = canvasRef.current;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(imageBitmap, 0, 0, 1280, 800);
              imageBitmap.close(); // Release resource
            }
          }).catch((err) => {
            console.error('ImageBitmap decoding stutters:', err);
          });
        }
      } catch (err) {
        console.error('Error drawing frame:', err);
      }
    };

    ws.onclose = () => {
      if (statusRef.current === 'active') {
        setStatus('idle');
      }
    };

    ws.onerror = () => {
      setStatus('error');
      setErrorMessage('WebSocket connection error.');
    };
  };

  // Input events: Mouse
  const sendMouseEvent = (e, type) => {
    if (status !== 'active' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    // Throttling mousemove to prevent flood
    if (type === 'mousemove') {
      const now = Date.now();
      if (now - lastMouseMoveRef.current < 40) return; // ~25fps throttle
      lastMouseMoveRef.current = now;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    let button = 'left';
    if (e.button === 1) button = 'middle';
    if (e.button === 2) button = 'right';

    wsRef.current.send(JSON.stringify({ type, x, y, button }));
  };

  // Input events: Scroll (includes pointer coordinates)
  const handleWheel = (e) => {
    if (status !== 'active' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    e.preventDefault();

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    wsRef.current.send(JSON.stringify({ type: 'scroll', deltaY: e.deltaY, x, y }));
  };

  // Input events: Keyboard
  const handleKeyDown = (e) => {
    if (status !== 'active' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    e.preventDefault();
    
    // Special key handling or standard key down
    wsRef.current.send(JSON.stringify({ type: 'keydown', key: e.key }));
  };

  const handleKeyUp = (e) => {
    if (status !== 'active' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    e.preventDefault();
    wsRef.current.send(JSON.stringify({ type: 'keyup', key: e.key }));
  };

  // URL Navigation
  const handleNavigate = (e) => {
    e.preventDefault();
    if (status !== 'active' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'navigate', url }));
  };

  // Setup default canvas text on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      drawIdleMonitor(canvas);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', padding: '20px', backgroundColor: '#060913', overflow: 'hidden' }}>
      {/* Top Loading Bar */}
      <div className={`top-loading-bar ${status}`} />

      {/* Control Panel / Navigation bar */}
      <header className="glass-panel" style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '16px', 
        padding: '16px 24px', 
        marginBottom: '20px',
        border: '1px solid rgba(0, 229, 118, 0.1)'
      }}>
        {/* Row 1: Brand Info + Status Display + Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          {/* Logo / Brand Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--accent-color)', fontSize: '1.25rem' }}>❖</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff', letterSpacing: '0.5px', fontFamily: 'Outfit, sans-serif' }}>
                  RemoteBrowser
                </span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'Fira Code', marginTop: '2px', opacity: 0.6 }}>
                v1.0.0 · CDP · local
              </span>
            </div>
          </div>

          {/* Status Display */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className={`status-badge ${status}`} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '20px',
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--panel-border)'
            }}>
              <div className={`status-dot ${status}`} />
              <span style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', fontFamily: 'Fira Code', color: '#ffffff' }}>
                {status.toUpperCase()}
              </span>
            </div>
            {status === 'starting' && (
              <div className="spinning-up-pill">
                <div className="mini-spinner" />
                <span style={{ fontSize: '0.75rem', fontFamily: 'Fira Code', color: '#f59e0b' }}>spinning up</span>
              </div>
            )}
          </div>

          {/* Buttons & Settings */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              type="button" 
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--panel-border)',
                borderRadius: '8px',
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              className="btn-settings"
            >
              ⚙️
            </button>

            {status === 'idle' || status === 'error' ? (
              <button 
                onClick={handleStart}
                className="btn-start"
                style={{
                  backgroundColor: 'var(--accent-color)',
                  color: '#080b11',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 0 14px var(--accent-glow)',
                  fontFamily: 'Outfit, sans-serif'
                }}
              >
                Start Session
              </button>
            ) : (
              <button 
                onClick={handleStop}
                disabled={status === 'stopping'}
                className="btn-stop"
                style={{
                  backgroundColor: 'var(--danger-color)',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  opacity: status === 'stopping' ? 0.6 : 1,
                  boxShadow: '0 0 14px var(--danger-glow)',
                  fontFamily: 'Outfit, sans-serif'
                }}
              >
                {status === 'stopping' ? 'Stopping...' : 'Stop Session'}
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Address Bar */}
        <div style={{ width: '100%' }}>
          <form onSubmit={handleNavigate} style={{ display: 'flex', width: '100%', gap: '12px' }}>
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'var(--input-bg)',
              border: '1px solid var(--panel-border)',
              borderRadius: '8px',
              padding: '0 12px',
              transition: 'border-color 0.2s'
            }} className="input-container">
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginRight: '8px' }}>🔒</span>
              <input 
                type="text" 
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={status !== 'active'}
                placeholder="https://"
                style={{
                  flex: 1,
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  fontFamily: 'Fira Code',
                  fontSize: '0.9rem',
                  outline: 'none',
                  padding: '10px 0'
                }}
              />
              {status === 'active' && (
                <button 
                  type="button"
                  onClick={handleNavigate}
                  style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    padding: '4px'
                  }}
                  title="Reload"
                >
                  ↻
                </button>
              )}
            </div>
            <button 
              type="submit"
              disabled={status !== 'active'}
              style={{
                backgroundColor: status === 'active' ? 'var(--accent-color)' : 'rgba(255, 255, 255, 0.05)',
                color: status === 'active' ? '#080b11' : 'var(--text-muted)',
                border: 'none',
                padding: '10px 24px',
                borderRadius: '8px',
                fontWeight: 700,
                cursor: status === 'active' ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>Go</span>
              <span>→</span>
            </button>
          </form>
        </div>
      </header>

      {/* Error Message */}
      {errorMessage && (
        <div className="glass-panel" style={{ padding: '12px 20px', borderLeft: '4px solid var(--danger-color)', marginBottom: '16px', color: 'var(--danger-color)' }}>
          {errorMessage}
        </div>
      )}

      {/* Main Viewport Container */}
      <div 
        className={`glass-panel ${status === 'active' ? 'pulsing-border' : ''}`}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
          padding: '8px',
          border: '1px solid rgba(0, 229, 118, 0.1)'
        }}
      >
        {/* Metabar details top left */}
        <div style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          fontFamily: 'Fira Code, monospace',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          pointerEvents: 'none',
          zIndex: 5
        }}>
          1280 × 800 · JPEG · 60fps
        </div>

        <canvas
          ref={canvasRef}
          width={1280}
          height={800}
          tabIndex={0}
          onMouseDown={(e) => sendMouseEvent(e, 'mousedown')}
          onMouseUp={(e) => sendMouseEvent(e, 'mouseup')}
          onMouseMove={(e) => sendMouseEvent(e, 'mousemove')}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: '1280/800',
            objectFit: 'contain',
            backgroundColor: '#05070f',
            cursor: status === 'active' ? 'crosshair' : 'default',
            outline: 'none',
            borderRadius: '8px'
          }}
        />

        {/* Canvas loading overlay with checklist */}
        {status === 'starting' && (
          <div className="canvas-loading-overlay">
            <div className="spinner" />
            <div className="loading-text">Initialising container ...</div>
            
            {/* Checklist */}
            <div className="checklist-container">
              <div className="checklist-item done">
                <span className="check-icon">✓</span>
                <span className="check-text">Building image</span>
              </div>
              <div className="checklist-item active">
                <span className="check-icon mini-spin">⟳</span>
                <span className="check-text">Starting container</span>
              </div>
              <div className="checklist-item pending">
                <span className="check-icon">•</span>
                <span className="check-text">Connecting CDP</span>
              </div>
            </div>
          </div>
        )}

        {/* Keyboard Capture Banner */}
        {status === 'active' && (
          <div style={{
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            backgroundColor: isFocused ? 'rgba(0, 229, 118, 0.9)' : 'rgba(0, 0, 0, 0.7)',
            color: isFocused ? '#080b11' : 'var(--text-secondary)',
            border: isFocused ? '1px solid var(--accent-color)' : '1px solid rgba(255, 255, 255, 0.1)',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '0.8rem',
            fontWeight: 600,
            pointerEvents: 'none',
            fontFamily: 'Fira Code',
            transition: 'all 0.2s',
            boxShadow: isFocused ? '0 0 10px var(--accent-glow)' : 'none'
          }}>
            {isFocused ? '⌨️ Keyboard Focus Active' : '⚠️ Click canvas to capture keys'}
          </div>
        )}

        {/* Floating toolbar at the bottom center of the viewport */}
        {status === 'active' && (
          <div className="floating-toolbar">
            <button className="toolbar-btn" title="Fullscreen">⛶</button>
            <button className="toolbar-btn" title="Text Input">T</button>
            <button className="toolbar-btn" title="Draw">✎</button>
            <button className="toolbar-btn" title="Comments">💬</button>
          </div>
        )}
      </div>
    </div>
  );
}
