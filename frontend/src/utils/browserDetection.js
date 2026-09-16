/**
 * Browser detection & Web Bluetooth capability analysis for CatLabel Studio
 */

/**
 * Detect the user's browser name and family
 */
export function detectBrowser(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) {
    return {
      name: 'Unknown Browser',
      isChromium: false,
      isFirefox: false,
      isSafari: false,
      isEdge: false,
      isOpera: false,
      isBrave: false,
      isBluefy: false,
      userAgent: ''
    };
  }

  const ua = nav.userAgent || '';
  const vendor = nav.vendor || '';

  const isFirefox = /firefox|fxios/i.test(ua);
  const isOpera = /opr\/|opera/i.test(ua);
  const isEdge = /edg\//i.test(ua);
  const isBluefy = /bluefy/i.test(ua);
  const isBrave = Boolean(nav.brave && typeof nav.brave.isBrave === 'function');
  const isChrome = !isEdge && !isOpera && /chrome|crios/i.test(ua) && (vendor.includes('Google') || isBrave);
  const isSafari = !isChrome && !isEdge && !isOpera && !isFirefox && /safari/i.test(ua) && vendor.includes('Apple');
  const isChromium = isChrome || isEdge || isOpera || isBrave || /chromium/i.test(ua);

  let name = 'Unknown Browser';
  if (isEdge) name = 'Microsoft Edge';
  else if (isOpera) name = 'Opera';
  else if (isBrave) name = 'Brave';
  else if (isBluefy) name = 'Bluefy';
  else if (isChrome) name = 'Google Chrome';
  else if (isFirefox) name = 'Mozilla Firefox';
  else if (isSafari) name = 'Apple Safari';
  else if (isChromium) name = 'Chromium-based Browser';

  return {
    name,
    isChromium,
    isFirefox,
    isSafari,
    isEdge,
    isOpera,
    isBrave,
    isBluefy,
    userAgent: ua
  };
}

/**
 * Assess Web Bluetooth compatibility and whether the local helper is required
 */
export function getBluetoothCapability(
  win = typeof window !== 'undefined' ? window : null,
  nav = typeof navigator !== 'undefined' ? navigator : null
) {
  const browser = detectBrowser(nav);

  if (!win || !nav) {
    return {
      browser,
      supportsWebBluetooth: false,
      requiresHelper: true,
      status: 'unsupported',
      title: 'Browser Not Supported',
      message: 'Environment does not support web APIs.'
    };
  }

  const hasBluetoothApi = Boolean(nav.bluetooth && typeof nav.bluetooth.requestDevice === 'function');
  const hostname = win.location?.hostname || '';
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isSecure = Boolean(win.isSecureContext || isLocalhost);

  // Case 1: Web Bluetooth natively supported and usable
  if (hasBluetoothApi) {
    return {
      browser,
      supportsWebBluetooth: true,
      requiresHelper: false,
      status: 'native_ready',
      title: `${browser.name} • Direct Bluetooth Ready`,
      message: 'Direct connection supported natively. No companion app or helper installation needed.'
    };
  }

  // Case 2: Browser is Chromium-based, but insecure context blocks Web Bluetooth
  if (browser.isChromium && !isSecure) {
    return {
      browser,
      supportsWebBluetooth: false,
      requiresHelper: true,
      status: 'needs_https',
      title: `${browser.name} • HTTPS Required for Web Bluetooth`,
      message: `${browser.name} supports Web Bluetooth, but the browser blocks it over unencrypted HTTP. Use HTTPS or run the local print helper.`
    };
  }

  // Case 2b: Browser is Chromium-based (e.g. Linux), but Web Bluetooth flag is not enabled
  if (browser.isChromium && isSecure && !hasBluetoothApi) {
    const isLinux = /linux|x11/i.test(browser.userAgent);
    return {
      browser,
      supportsWebBluetooth: false,
      requiresHelper: true,
      status: 'chromium_flag_needed',
      title: `${browser.name} • Direct Bluetooth Needs Flag`,
      message: isLinux
        ? 'On Linux, Google Chrome requires enabling Web Bluetooth in chrome://flags. Visit chrome://flags/#enable-web-bluetooth-new-permissions-backend, enable it, and restart Chrome for direct printing. Alternatively, download the standalone Print Helper below.'
        : `${browser.name} has Web Bluetooth disabled. Enable it in browser settings or use the standalone Print Helper below.`
    };
  }

  // Case 3: Mozilla Firefox
  if (browser.isFirefox) {
    return {
      browser,
      supportsWebBluetooth: false,
      requiresHelper: true,
      status: 'firefox_helper_required',
      title: 'Mozilla Firefox • Helper Mode',
      message: 'Firefox does not support Web Bluetooth natively. Use the OpenNiimStudio Print Helper companion or open this page in Google Chrome/Edge for zero-install printing.'
    };
  }

  // Case 4: Apple Safari
  if (browser.isSafari) {
    return {
      browser,
      supportsWebBluetooth: false,
      requiresHelper: true,
      status: 'safari_helper_required',
      title: 'Apple Safari • Helper Mode',
      message: 'Safari does not support Web Bluetooth. Use the OpenNiimStudio Print Helper companion or open this page in Google Chrome/Edge for zero-install printing.'
    };
  }

  // Case 5: Other browser
  return {
    browser,
    supportsWebBluetooth: false,
    requiresHelper: true,
    status: 'unsupported_browser',
    title: `${browser.name} • Helper Mode`,
    message: 'This browser does not support Web Bluetooth natively. Use the OpenNiimStudio Print Helper companion or open in Google Chrome/Edge.'
  };
}
