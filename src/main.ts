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
 * - Window size selection for different streaming needs
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
  label: string;
}

// ============================================================
// Constants
// ============================================================

/** Height of the control bar in pixels */
const CONTROL_BAR_HEIGHT = 50;

/** Available window size presets */
const SIZE_PRESETS: Record<string, SizePreset> = {
  '1920x1080': { width: 1920, height: 1080, label: '1080p' },
  '1280x720': { width: 1280, height: 720, label: '720p' },
  '854x480': { width: 854, height: 480, label: '480p' },
  '640x360': { width: 640, height: 360, label: '360p' },
  '1080x1920': { width: 1080, height: 1920, label: 'Vertical 1080' },
  '720x1280': { width: 720, height: 1280, label: 'Vertical 720' },
};

// ============================================================
// State
// ============================================================

/** Currently loaded stream URL (original, not embed URL) */
let currentStreamUrl: string | null = null;

/** Currently loaded platform */
let currentPlatform: Platform = null;

// ============================================================
// DOM Elements
// ============================================================

let sizeSelect: HTMLSelectElement;
let urlInput: HTMLInputElement;
let loadBtn: HTMLButtonElement;
let statusText: HTMLElement;
let playerContainer: HTMLElement;
let placeholder: HTMLElement;

// ============================================================
// Utility Functions
// ============================================================

/**
 * Gets the current player area dimensions (excluding control bar)
 */
function getPlayerDimensions(): { width: number; height: number } {
  const preset = SIZE_PRESETS[sizeSelect.value];
  if (preset) {
    return {
      width: preset.width,
      height: preset.height - CONTROL_BAR_HEIGHT
    };
  }
  // Fallback to container size
  return {
    width: playerContainer.clientWidth || 1280,
    height: playerContainer.clientHeight || 670
  };
}

// ============================================================
// Window Size Functions
// ============================================================

/**
 * Resizes the Tauri window to the selected size
 */
async function resizeWindow(sizeKey: string): Promise<void> {
  const preset = SIZE_PRESETS[sizeKey];
  if (!preset) {
    console.error('Prasaran: Invalid size preset', sizeKey);
    return;
  }

  try {
    const appWindow = getCurrentWindow();
    
    // Use LogicalSize for consistent sizing across different DPI settings
    await appWindow.setSize(new LogicalSize(preset.width, preset.height));
    
    // Center the window after resize
    await appWindow.center();
    
    setStatus(`Resized to ${preset.width}x${preset.height}`, 'success');
    console.log(`Prasaran: Window resized to ${preset.width}x${preset.height}`);
    
    // If Facebook stream is loaded, reload it with new dimensions
    if (currentPlatform === 'facebook' && currentStreamUrl) {
      reloadCurrentStream();
    }
  } catch (err) {
    setStatus('Failed to resize window', 'error');
    console.error('Prasaran: Failed to resize window', err);
  }
}

/**
 * Handles size selector change
 */
function handleSizeChange(): void {
  const selectedSize = sizeSelect.value;
  resizeWindow(selectedSize);
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
    
    // YouTube detection
    if (
      hostname.includes('youtube.com') ||
      hostname.includes('youtu.be') ||
      hostname.includes('youtube-nocookie.com')
    ) {
      return 'youtube';
    }
    
    // Facebook detection
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
 * Supports: watch?v=, youtu.be/, live/, embed/, shorts/
 */
function extractYouTubeVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Format: youtube.com/watch?v=VIDEO_ID
    if (urlObj.searchParams.has('v')) {
      return urlObj.searchParams.get('v');
    }
    
    // Format: youtu.be/VIDEO_ID
    if (hostname.includes('youtu.be')) {
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        return pathParts[0];
      }
    }
    
    // Format: youtube.com/live/VIDEO_ID or /embed/VIDEO_ID or /shorts/VIDEO_ID
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
  // Using youtube-nocookie.com for privacy
  // autoplay=1: Auto-start playback
  // rel=0: Don't show related videos
  // modestbranding=1: Minimal YouTube branding
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
}

/**
 * Builds Facebook embed URL from video URL
 * Facebook requires explicit width and height parameters for proper sizing
 */
function buildFacebookEmbedUrl(originalUrl: string): string {
  const encodedUrl = encodeURIComponent(originalUrl);
  const dimensions = getPlayerDimensions();
  
  // Facebook embed requires explicit width/height for proper scaling
  // show_text=false: Hide post text
  // autoplay=true: Auto-start playback
  // allowfullscreen=true: Allow fullscreen
  return `https://www.facebook.com/plugins/video.php?href=${encodedUrl}&width=${dimensions.width}&height=${dimensions.height}&show_text=false&autoplay=true&allowfullscreen=true`;
}

/**
 * Parses a URL and returns embed information
 */
function parseStreamUrl(url: string): ParseResult {
  // Trim whitespace
  const trimmedUrl = url.trim();
  
  // Check for empty input
  if (!trimmedUrl) {
    return {
      platform: null,
      embedUrl: null,
      error: 'Please enter a URL'
    };
  }
  
  // Validate URL format
  try {
    new URL(trimmedUrl);
  } catch {
    return {
      platform: null,
      embedUrl: null,
      error: 'Invalid URL format'
    };
  }
  
  // Detect platform
  const platform = detectPlatform(trimmedUrl);
  
  if (!platform) {
    return {
      platform: null,
      embedUrl: null,
      error: 'URL must be from YouTube or Facebook'
    };
  }
  
  // Build embed URL based on platform
  if (platform === 'youtube') {
    const videoId = extractYouTubeVideoId(trimmedUrl);
    if (!videoId) {
      return {
        platform: 'youtube',
        embedUrl: null,
        error: 'Could not extract YouTube video ID'
      };
    }
    return {
      platform: 'youtube',
      embedUrl: buildYouTubeEmbedUrl(videoId),
      error: null
    };
  }
  
  if (platform === 'facebook') {
    return {
      platform: 'facebook',
      embedUrl: buildFacebookEmbedUrl(trimmedUrl),
      error: null
    };
  }
  
  return {
    platform: null,
    embedUrl: null,
    error: 'Unsupported platform'
  };
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
  // First, destroy any existing iframe
  destroyCurrentIframe();
  
  // Hide placeholder
  hidePlaceholder();
  
  // Create new iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'stream-iframe';
  iframe.src = embedUrl;
  
  // Allow necessary features for video playback
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  
  // Set appropriate title for accessibility
  iframe.title = platform === 'youtube' ? 'YouTube Live Stream' : 'Facebook Live Stream';
  
  // Append to container
  playerContainer.appendChild(iframe);
}

/**
 * Reloads the current stream (used when window size changes for Facebook)
 */
function reloadCurrentStream(): void {
  if (!currentStreamUrl || !currentPlatform) {
    return;
  }
  
  const result = parseStreamUrl(currentStreamUrl);
  if (result.embedUrl && result.platform) {
    createIframe(result.embedUrl, result.platform);
    setStatus('Stream reloaded for new size', 'success');
  }
}

/**
 * Handles the Load Stream button click
 */
function handleLoadStream(): void {
  const url = urlInput.value;
  
  // Parse the URL
  const result = parseStreamUrl(url);
  
  // Handle errors
  if (result.error) {
    setStatus(result.error, 'error');
    return;
  }
  
  // Load the stream
  if (result.embedUrl && result.platform) {
    setStatus(`Loading ${result.platform}...`, 'info');
    
    try {
      // Store current stream info for potential reload
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
 * Initializes the application when DOM is ready
 */
function init(): void {
  // Get DOM elements
  sizeSelect = document.getElementById('size-select') as HTMLSelectElement;
  urlInput = document.getElementById('url-input') as HTMLInputElement;
  loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
  statusText = document.getElementById('status-text') as HTMLElement;
  playerContainer = document.getElementById('player-container') as HTMLElement;
  placeholder = document.getElementById('placeholder') as HTMLElement;
  
  // Validate all elements exist
  if (!sizeSelect || !urlInput || !loadBtn || !statusText || !playerContainer || !placeholder) {
    console.error('Prasaran: Required DOM elements not found');
    return;
  }
  
  // Attach event listeners
  sizeSelect.addEventListener('change', handleSizeChange);
  loadBtn.addEventListener('click', handleLoadStream);
  urlInput.addEventListener('keypress', handleKeyPress);
  
  // Initial status
  setStatus('Ready', 'info');
  
  console.log('Prasaran: Initialized successfully');
}

// Start the application when DOM is loaded
window.addEventListener('DOMContentLoaded', init);
