/**
 * Prasaran - Stream Viewer
 * 
 * Lightweight stream viewer for Facebook Live and YouTube Live.
 * Designed for OBS Window Capture on low-power hardware.
 * 
 * Features:
 * - URL detection for YouTube and Facebook
 * - Official embedded players only (iframe-based)
 * - Window size presets with screen limiting
 * - Video scaling modes: Fit, Stretch, Fill
 * - Fullscreen support (no stream restart)
 * - Responsive window resizing
 */

import { getCurrentWindow, LogicalSize, currentMonitor } from '@tauri-apps/api/window';

// ============================================================
// Types
// ============================================================

type Platform = 'youtube' | 'facebook' | null;
type ScaleMode = 'fit' | 'stretch' | 'fill';

interface ParseResult {
  platform: Platform;
  embedUrl: string | null;
  error: string | null;
}

interface SizePreset {
  width: number;
  height: number;
}

// ============================================================
// Constants
// ============================================================

const SIZE_PRESETS: Record<string, SizePreset> = {
  '1920x1080': { width: 1920, height: 1080 },
  '1280x720': { width: 1280, height: 720 },
  '854x480': { width: 854, height: 480 },
  '640x360': { width: 640, height: 360 },
  '1080x1920': { width: 1080, height: 1920 },
  '720x1280': { width: 720, height: 1280 },
};

// Large default size for Facebook embeds to avoid pixelation when scaling up
const FB_EMBED_WIDTH = 1920;
const FB_EMBED_HEIGHT = 1080;

// ============================================================
// State
// ============================================================

let currentStreamUrl: string | null = null;
let currentPlatform: Platform = null;
let isMaximized = true;
let isFullscreen = false;
let screenWidth = 1920;
let screenHeight = 1080;

// ============================================================
// DOM Elements
// ============================================================

let fullscreenBtn: HTMLButtonElement;
let maximizeBtn: HTMLButtonElement;
let sizeSelect: HTMLSelectElement;
let scaleMode: HTMLSelectElement;
let urlInput: HTMLInputElement;
let loadBtn: HTMLButtonElement;
let reloadBtn: HTMLButtonElement;
let statusText: HTMLElement;
let playerContainer: HTMLElement;
let placeholder: HTMLElement;

// ============================================================
// Screen & Window Functions
// ============================================================

async function updateScreenSize(): Promise<void> {
  try {
    const monitor = await currentMonitor();
    if (monitor) {
      screenWidth = monitor.size.width;
      screenHeight = monitor.size.height;
    }
  } catch (err) {
    console.error('Prasaran: Failed to get screen size', err);
  }
}

function limitToScreen(width: number, height: number): { width: number; height: number } {
  const maxWidth = screenWidth - 50;
  const maxHeight = screenHeight - 100;
  return {
    width: Math.min(width, maxWidth),
    height: Math.min(height, maxHeight)
  };
}

// ============================================================
// Fullscreen Functions
// ============================================================

async function toggleFullscreen(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    isFullscreen = !isFullscreen;
    await appWindow.setFullscreen(isFullscreen);
    document.body.classList.toggle('fullscreen', isFullscreen);
    updateFullscreenButtonIcon();
    setStatus(isFullscreen ? 'Fullscreen' : 'Windowed', 'success');
    // No stream reload - CSS handles scaling
  } catch (err) {
    setStatus('Fullscreen failed', 'error');
    console.error('Prasaran: Fullscreen toggle failed', err);
  }
}

function updateFullscreenButtonIcon(): void {
  fullscreenBtn.innerHTML = isFullscreen ? '&#x2716;' : '&#x26F6;';
  fullscreenBtn.title = isFullscreen ? 'Exit Fullscreen (F11/Esc)' : 'Fullscreen (F11)';
}

// ============================================================
// Maximize Functions
// ============================================================

function updateMaximizeButtonIcon(): void {
  maximizeBtn.innerHTML = isMaximized ? '&#9634;' : '&#9744;';
  maximizeBtn.title = isMaximized ? 'Restore Down' : 'Maximize';
}

async function toggleMaximize(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    
    if (isMaximized) {
      await appWindow.unmaximize();
      const sizeKey = sizeSelect.value;
      const preset = SIZE_PRESETS[sizeKey];
      if (preset) {
        const limited = limitToScreen(preset.width, preset.height);
        await appWindow.setSize(new LogicalSize(limited.width, limited.height));
        await appWindow.center();
      }
      isMaximized = false;
      setStatus('Restored', 'success');
    } else {
      await appWindow.maximize();
      isMaximized = true;
      setStatus('Maximized', 'success');
    }
    
    updateMaximizeButtonIcon();
    // No stream reload - CSS handles scaling
  } catch (err) {
    setStatus('Failed', 'error');
    console.error('Prasaran: Maximize toggle failed', err);
  }
}

// ============================================================
// Size Functions
// ============================================================

async function handleSizeChange(): Promise<void> {
  if (isMaximized) {
    setStatus('Restore first', 'info');
    return;
  }
  
  const sizeKey = sizeSelect.value;
  const preset = SIZE_PRESETS[sizeKey];
  
  if (!preset) return;

  try {
    const appWindow = getCurrentWindow();
    const limited = limitToScreen(preset.width, preset.height);
    await appWindow.setSize(new LogicalSize(limited.width, limited.height));
    await appWindow.center();
    
    setStatus(`${limited.width}x${limited.height}`, 'success');
    // No stream reload - CSS handles scaling
  } catch (err) {
    setStatus('Resize failed', 'error');
  }
}

// ============================================================
// Scale Mode Functions
// ============================================================

function handleScaleModeChange(): void {
  const mode = scaleMode.value as ScaleMode;
  
  // Remove all scale classes
  playerContainer.classList.remove('scale-fit', 'scale-stretch', 'scale-fill');
  
  // Add selected scale class
  playerContainer.classList.add(`scale-${mode}`);
  
  setStatus(`${mode.charAt(0).toUpperCase() + mode.slice(1)} mode`, 'success');
}

// ============================================================
// URL Parsing Functions
// ============================================================

function detectPlatform(url: string): Platform {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
    if (hostname.includes('facebook.com') || hostname.includes('fb.watch') || hostname.includes('fb.com')) return 'facebook';
    return null;
  } catch {
    return null;
  }
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    if (urlObj.searchParams.has('v')) return urlObj.searchParams.get('v');
    if (urlObj.hostname.includes('youtu.be')) {
      const parts = urlObj.pathname.split('/').filter(Boolean);
      if (parts.length > 0) return parts[0];
    }
    const match = urlObj.pathname.match(/\/(live|embed|shorts|v)\/([a-zA-Z0-9_-]+)/);
    if (match?.[2]) return match[2];
    return null;
  } catch {
    return null;
  }
}

function buildYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
}

function buildFacebookEmbedUrl(originalUrl: string): string {
  const encodedUrl = encodeURIComponent(originalUrl);
  // Use large fixed dimensions so the embed has high quality
  // CSS will handle scaling to fit the container
  return `https://www.facebook.com/plugins/video.php?href=${encodedUrl}&width=${FB_EMBED_WIDTH}&height=${FB_EMBED_HEIGHT}&show_text=false&autoplay=true&allowfullscreen=true`;
}

function parseStreamUrl(url: string): ParseResult {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return { platform: null, embedUrl: null, error: 'Enter a URL' };
  
  try { new URL(trimmedUrl); } catch { return { platform: null, embedUrl: null, error: 'Invalid URL' }; }
  
  const platform = detectPlatform(trimmedUrl);
  if (!platform) return { platform: null, embedUrl: null, error: 'Use YouTube or Facebook' };
  
  if (platform === 'youtube') {
    const videoId = extractYouTubeVideoId(trimmedUrl);
    if (!videoId) return { platform: 'youtube', embedUrl: null, error: 'Invalid YouTube URL' };
    return { platform: 'youtube', embedUrl: buildYouTubeEmbedUrl(videoId), error: null };
  }
  
  return { platform: 'facebook', embedUrl: buildFacebookEmbedUrl(trimmedUrl), error: null };
}

// ============================================================
// UI Functions
// ============================================================

function setStatus(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
  statusText.textContent = message;
  statusText.className = type;
}

function destroyCurrentIframe(): void {
  document.getElementById('stream-iframe')?.remove();
}

function hidePlaceholder(): void {
  placeholder.style.display = 'none';
}

function createIframe(embedUrl: string, platform: Platform): void {
  destroyCurrentIframe();
  hidePlaceholder();
  
  const iframe = document.createElement('iframe');
  iframe.id = 'stream-iframe';
  iframe.src = embedUrl;
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('frameborder', '0');
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  iframe.title = platform === 'youtube' ? 'YouTube Stream' : 'Facebook Stream';
  
  playerContainer.appendChild(iframe);
}

function handleLoadStream(): void {
  const result = parseStreamUrl(urlInput.value);
  
  if (result.error) {
    setStatus(result.error, 'error');
    return;
  }
  
  if (result.embedUrl && result.platform) {
    setStatus('Loading...', 'info');
    currentStreamUrl = urlInput.value;
    currentPlatform = result.platform;
    createIframe(result.embedUrl, result.platform);
    setStatus(result.platform === 'youtube' ? 'YouTube' : 'Facebook', 'success');
  }
}

function handleReloadStream(): void {
  if (!currentStreamUrl || !currentPlatform) {
    setStatus('No stream loaded', 'error');
    return;
  }
  
  const result = parseStreamUrl(currentStreamUrl);
  
  if (result.embedUrl && result.platform) {
    setStatus('Reloading...', 'info');
    createIframe(result.embedUrl, result.platform);
    setStatus(result.platform === 'youtube' ? 'YouTube' : 'Facebook', 'success');
  }
}

function handleKeyPress(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleLoadStream();
  }
}

function handleKeyDown(event: KeyboardEvent): void {
  // F11 for fullscreen toggle
  if (event.key === 'F11') {
    event.preventDefault();
    toggleFullscreen();
  } else if (event.key === 'Escape' && isFullscreen) {
    toggleFullscreen();
  }
}

// ============================================================
// Initialization
// ============================================================

async function checkMaximizedState(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    isMaximized = await appWindow.isMaximized();
    isFullscreen = await appWindow.isFullscreen();
    updateMaximizeButtonIcon();
    updateFullscreenButtonIcon();
    document.body.classList.toggle('fullscreen', isFullscreen);
  } catch (err) {
    console.error('Prasaran: State check failed', err);
  }
}

async function init(): Promise<void> {
  // Get DOM elements
  fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
  maximizeBtn = document.getElementById('maximize-btn') as HTMLButtonElement;
  sizeSelect = document.getElementById('size-select') as HTMLSelectElement;
  scaleMode = document.getElementById('scale-mode') as HTMLSelectElement;
  urlInput = document.getElementById('url-input') as HTMLInputElement;
  loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
  reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;
  statusText = document.getElementById('status-text') as HTMLElement;
  playerContainer = document.getElementById('player-container') as HTMLElement;
  placeholder = document.getElementById('placeholder') as HTMLElement;
  
  if (!fullscreenBtn || !maximizeBtn || !sizeSelect || !scaleMode || !urlInput || !loadBtn || !reloadBtn || !statusText || !playerContainer || !placeholder) {
    console.error('Prasaran: DOM elements not found');
    return;
  }
  
  await updateScreenSize();
  
  // Event listeners
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  maximizeBtn.addEventListener('click', toggleMaximize);
  sizeSelect.addEventListener('change', handleSizeChange);
  scaleMode.addEventListener('change', handleScaleModeChange);
  loadBtn.addEventListener('click', handleLoadStream);
  reloadBtn.addEventListener('click', handleReloadStream);
  urlInput.addEventListener('keypress', handleKeyPress);
  document.addEventListener('keydown', handleKeyDown);
  
  await checkMaximizedState();
  setStatus('Ready', 'info');
  console.log('Prasaran: Initialized');
}

window.addEventListener('DOMContentLoaded', init);
