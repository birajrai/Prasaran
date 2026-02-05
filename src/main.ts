/**
 * Prasaran - Stream Viewer
 * 
 * Lightweight stream viewer for Facebook Live and YouTube Live.
 * Designed for OBS Window Capture on low-power hardware.
 * 
 * Features:
 * - URL detection for YouTube and Facebook
 * - Official embedded players only (iframe-based)
 * - Clean iframe replacement (old iframe destroyed before new one)
 * - Maximize/Restore window toggle (starts maximized)
 * - Window size presets for restored mode
 * - Defensive error handling
 */

import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

// ============================================================
// Types
// ============================================================

/** Supported streaming platforms */
type Platform = 'youtube' | 'facebook' | null;

/** Result of URL parsing */
interface ParseResult {
  platform: Platform;
  embedUrl: string | null;
  error: string | null;
}

/** Window size preset */
interface SizePreset {
  width: number;
  height: number;
}

// ============================================================
// Constants
// ============================================================

/** Available window size presets */
const SIZE_PRESETS: Record<string, SizePreset> = {
  '1920x1080': { width: 1920, height: 1080 },
  '1280x720': { width: 1280, height: 720 },
  '854x480': { width: 854, height: 480 },
  '640x360': { width: 640, height: 360 },
  '1080x1920': { width: 1080, height: 1920 },
  '720x1280': { width: 720, height: 1280 },
};

// ============================================================
// State
// ============================================================

/** Currently loaded stream URL (original, not embed URL) */
let currentStreamUrl: string | null = null;

/** Currently loaded platform */
let currentPlatform: Platform = null;

/** Whether window is currently maximized */
let isMaximized = true;

// ============================================================
// DOM Elements
// ============================================================

let maximizeBtn: HTMLButtonElement;
let sizeSelect: HTMLSelectElement;
let urlInput: HTMLInputElement;
let loadBtn: HTMLButtonElement;
let statusText: HTMLElement;
let playerContainer: HTMLElement;
let placeholder: HTMLElement;

// ============================================================
// Window Functions
// ============================================================

/**
 * Updates the maximize button icon based on current state
 */
function updateMaximizeButtonIcon(): void {
  // &#9634; = restore icon (overlapping squares), &#9744; = maximize icon (single square)
  maximizeBtn.innerHTML = isMaximized ? '&#9634;' : '&#9744;';
  maximizeBtn.title = isMaximized ? 'Restore Down' : 'Maximize';
}

/**
 * Toggles between maximized and restored window state
 */
async function toggleMaximize(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    
    if (isMaximized) {
      // Restore to selected size
      await appWindow.unmaximize();
      const sizeKey = sizeSelect.value;
      const preset = SIZE_PRESETS[sizeKey];
      if (preset) {
        await appWindow.setSize(new LogicalSize(preset.width, preset.height));
        await appWindow.center();
      }
      isMaximized = false;
      setStatus(`Restored to ${sizeKey}`, 'success');
    } else {
      // Maximize
      await appWindow.maximize();
      isMaximized = true;
      setStatus('Maximized', 'success');
    }
    
    updateMaximizeButtonIcon();
    
    // Reload Facebook stream if loaded (needs new dimensions)
    if (currentPlatform === 'facebook' && currentStreamUrl) {
      setTimeout(() => reloadCurrentStream(), 100);
    }
  } catch (err) {
    setStatus('Failed to toggle window', 'error');
    console.error('Prasaran: Failed to toggle maximize', err);
  }
}

/**
 * Handles size selector change (only applies when not maximized)
 */
async function handleSizeChange(): Promise<void> {
  if (isMaximized) {
    // If maximized, just store the preference for when restored
    setStatus('Size will apply when restored', 'info');
    return;
  }
  
  const sizeKey = sizeSelect.value;
  const preset = SIZE_PRESETS[sizeKey];
  
  if (!preset) {
    console.error('Prasaran: Invalid size preset', sizeKey);
    return;
  }

  try {
    const appWindow = getCurrentWindow();
    await appWindow.setSize(new LogicalSize(preset.width, preset.height));
    await appWindow.center();
    
    setStatus(`Resized to ${preset.width}x${preset.height}`, 'success');
    
    // Reload Facebook stream if loaded
    if (currentPlatform === 'facebook' && currentStreamUrl) {
      setTimeout(() => reloadCurrentStream(), 100);
    }
  } catch (err) {
    setStatus('Failed to resize', 'error');
    console.error('Prasaran: Failed to resize window', err);
  }
}

/**
 * Gets current player container dimensions
 */
function getPlayerDimensions(): { width: number; height: number } {
  // Use actual container size for accurate dimensions
  const width = playerContainer.clientWidth || 1280;
  const height = playerContainer.clientHeight || 670;
  return { width, height };
}

// ============================================================
// URL Parsing Functions
// ============================================================

/**
 * Detects the platform from a URL
 */
function detectPlatform(url: string): Platform {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    if (
      hostname.includes('youtube.com') ||
      hostname.includes('youtu.be') ||
      hostname.includes('youtube-nocookie.com')
    ) {
      return 'youtube';
    }
    
    if (
      hostname.includes('facebook.com') ||
      hostname.includes('fb.watch') ||
      hostname.includes('fb.com')
    ) {
      return 'facebook';
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts YouTube video ID from various URL formats
 */
function extractYouTubeVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    if (urlObj.searchParams.has('v')) {
      return urlObj.searchParams.get('v');
    }
    
    if (hostname.includes('youtu.be')) {
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        return pathParts[0];
      }
    }
    
    const pathMatch = urlObj.pathname.match(/\/(live|embed|shorts|v)\/([a-zA-Z0-9_-]+)/);
    if (pathMatch && pathMatch[2]) {
      return pathMatch[2];
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Builds YouTube embed URL from video ID
 */
function buildYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
}

/**
 * Builds Facebook embed URL from video URL
 * Uses current player dimensions for proper sizing
 */
function buildFacebookEmbedUrl(originalUrl: string): string {
  const encodedUrl = encodeURIComponent(originalUrl);
  const { width, height } = getPlayerDimensions();
  
  // Facebook embed with explicit dimensions matching the container
  return `https://www.facebook.com/plugins/video.php?href=${encodedUrl}&width=${width}&height=${height}&show_text=false&autoplay=true&allowfullscreen=true&mute=false`;
}

/**
 * Parses a URL and returns embed information
 */
function parseStreamUrl(url: string): ParseResult {
  const trimmedUrl = url.trim();
  
  if (!trimmedUrl) {
    return { platform: null, embedUrl: null, error: 'Please enter a URL' };
  }
  
  try {
    new URL(trimmedUrl);
  } catch {
    return { platform: null, embedUrl: null, error: 'Invalid URL format' };
  }
  
  const platform = detectPlatform(trimmedUrl);
  
  if (!platform) {
    return { platform: null, embedUrl: null, error: 'URL must be from YouTube or Facebook' };
  }
  
  if (platform === 'youtube') {
    const videoId = extractYouTubeVideoId(trimmedUrl);
    if (!videoId) {
      return { platform: 'youtube', embedUrl: null, error: 'Could not extract YouTube video ID' };
    }
    return { platform: 'youtube', embedUrl: buildYouTubeEmbedUrl(videoId), error: null };
  }
  
  if (platform === 'facebook') {
    return { platform: 'facebook', embedUrl: buildFacebookEmbedUrl(trimmedUrl), error: null };
  }
  
  return { platform: null, embedUrl: null, error: 'Unsupported platform' };
}

// ============================================================
// UI Functions
// ============================================================

/**
 * Updates the status text display
 */
function setStatus(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
  statusText.textContent = message;
  statusText.className = type;
}

/**
 * Removes existing iframe from player container
 */
function destroyCurrentIframe(): void {
  const existingIframe = document.getElementById('stream-iframe');
  if (existingIframe) {
    existingIframe.remove();
  }
}

/**
 * Hides the placeholder text
 */
function hidePlaceholder(): void {
  placeholder.style.display = 'none';
}

/**
 * Creates and injects a new iframe with the given embed URL
 */
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
  iframe.title = platform === 'youtube' ? 'YouTube Live Stream' : 'Facebook Live Stream';
  
  playerContainer.appendChild(iframe);
}

/**
 * Reloads the current stream with updated dimensions
 */
function reloadCurrentStream(): void {
  if (!currentStreamUrl || !currentPlatform) {
    return;
  }
  
  const result = parseStreamUrl(currentStreamUrl);
  if (result.embedUrl && result.platform) {
    createIframe(result.embedUrl, result.platform);
    console.log('Prasaran: Stream reloaded with new dimensions');
  }
}

/**
 * Handles the Load Stream button click
 */
function handleLoadStream(): void {
  const url = urlInput.value;
  const result = parseStreamUrl(url);
  
  if (result.error) {
    setStatus(result.error, 'error');
    return;
  }
  
  if (result.embedUrl && result.platform) {
    setStatus(`Loading ${result.platform}...`, 'info');
    
    try {
      currentStreamUrl = url;
      currentPlatform = result.platform;
      
      createIframe(result.embedUrl, result.platform);
      setStatus(`${result.platform === 'youtube' ? 'YouTube' : 'Facebook'} loaded`, 'success');
    } catch (err) {
      setStatus('Failed to load stream', 'error');
      console.error('Prasaran: Failed to create iframe', err);
    }
  }
}

/**
 * Handles Enter key press in URL input
 */
function handleKeyPress(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleLoadStream();
  }
}

// ============================================================
// Initialization
// ============================================================

/**
 * Checks if window is currently maximized and updates state
 */
async function checkMaximizedState(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    isMaximized = await appWindow.isMaximized();
    updateMaximizeButtonIcon();
  } catch (err) {
    console.error('Prasaran: Failed to check maximized state', err);
  }
}

/**
 * Initializes the application when DOM is ready
 */
function init(): void {
  // Get DOM elements
  maximizeBtn = document.getElementById('maximize-btn') as HTMLButtonElement;
  sizeSelect = document.getElementById('size-select') as HTMLSelectElement;
  urlInput = document.getElementById('url-input') as HTMLInputElement;
  loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
  statusText = document.getElementById('status-text') as HTMLElement;
  playerContainer = document.getElementById('player-container') as HTMLElement;
  placeholder = document.getElementById('placeholder') as HTMLElement;
  
  // Validate all elements exist
  if (!maximizeBtn || !sizeSelect || !urlInput || !loadBtn || !statusText || !playerContainer || !placeholder) {
    console.error('Prasaran: Required DOM elements not found');
    return;
  }
  
  // Attach event listeners
  maximizeBtn.addEventListener('click', toggleMaximize);
  sizeSelect.addEventListener('change', handleSizeChange);
  loadBtn.addEventListener('click', handleLoadStream);
  urlInput.addEventListener('keypress', handleKeyPress);
  
  // Check initial maximized state
  checkMaximizedState();
  
  // Initial status
  setStatus('Ready', 'info');
  
  console.log('Prasaran: Initialized successfully');
}

// Start the application when DOM is loaded
window.addEventListener('DOMContentLoaded', init);
