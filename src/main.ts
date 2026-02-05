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
 * - Defensive error handling
 */

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

// ============================================================
// DOM Elements
// ============================================================

let urlInput: HTMLInputElement;
let loadBtn: HTMLButtonElement;
let statusText: HTMLElement;
let playerContainer: HTMLElement;
let placeholder: HTMLElement;

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
 * Facebook requires the full video URL to be passed as href parameter
 */
function buildFacebookEmbedUrl(originalUrl: string): string {
  // Encode the original URL for use in the embed
  const encodedUrl = encodeURIComponent(originalUrl);
  // autoplay=true: Auto-start playback
  // width/height handled by iframe styling
  return `https://www.facebook.com/plugins/video.php?href=${encodedUrl}&show_text=false&autoplay=true`;
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
 * Shows the placeholder text
 */
function showPlaceholder(): void {
  placeholder.style.display = 'block';
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
  urlInput = document.getElementById('url-input') as HTMLInputElement;
  loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
  statusText = document.getElementById('status-text') as HTMLElement;
  playerContainer = document.getElementById('player-container') as HTMLElement;
  placeholder = document.getElementById('placeholder') as HTMLElement;
  
  // Validate all elements exist
  if (!urlInput || !loadBtn || !statusText || !playerContainer || !placeholder) {
    console.error('Prasaran: Required DOM elements not found');
    return;
  }
  
  // Attach event listeners
  loadBtn.addEventListener('click', handleLoadStream);
  urlInput.addEventListener('keypress', handleKeyPress);
  
  // Initial status
  setStatus('Ready', 'info');
  
  console.log('Prasaran: Initialized successfully');
}

// Start the application when DOM is loaded
window.addEventListener('DOMContentLoaded', init);
