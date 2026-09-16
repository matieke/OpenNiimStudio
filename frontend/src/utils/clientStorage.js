/**
 * Client-Side Storage Adapter
 * Stores user preferences, printer profiles, and projects in the browser's localStorage
 * so that users connecting to a shared Docker container maintain private local data.
 */

const STORAGE_KEYS = {
  SETTINGS: 'openniim_client_settings',
  PRINTER_PROFILES: 'openniim_client_printer_profiles',
  PROJECTS: 'openniim_client_projects',
  CATEGORIES: 'openniim_client_categories',
  CUSTOM_PRESETS: 'openniim_client_custom_presets',
  RFID_PRESETS: 'openniim_rfid_presets',
  ADDRESSES: 'openniim_client_addresses',
  STORAGE_MODE: 'openniim_storage_mode', // 'local' | 'server'
};

const LEGACY_STORAGE_KEYS = {
  SETTINGS: 'catlabel_client_settings',
  PRINTER_PROFILES: 'catlabel_client_printer_profiles',
  PROJECTS: 'catlabel_client_projects',
  CATEGORIES: 'catlabel_client_categories',
  CUSTOM_PRESETS: 'catlabel_client_custom_presets',
  RFID_PRESETS: 'catlabel_rfid_presets',
  ADDRESSES: 'catlabel_client_addresses',
  STORAGE_MODE: 'catlabel_storage_mode',
};

export const DEFAULT_SETTINGS = {
  paper_width_mm: 58.0,
  print_width_mm: 48.0,
  default_dpi: 203,
  speed: 0,
  energy: 0,
  feed_lines: 50,
  default_font: 'RobotoCondensed.ttf',
  intended_media_type: 'unknown',
};

function getStorage() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

function getItem(key, fallback = null, legacyKey = null) {
  const storage = getStorage();
  if (!storage) return fallback;
  try {
    let raw = storage.getItem(key);
    if (!raw && legacyKey) {
      raw = storage.getItem(legacyKey);
      if (raw) {
        // Automatically migrate legacy key to new key
        try { storage.setItem(key, raw); } catch (_e) {}
      }
    }
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Failed to read ${key} from localStorage:`, err);
    return fallback;
  }
}

function setItem(key, value) {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`Failed to write ${key} to localStorage:`, err);
    return false;
  }
}

export function isClientStorageAvailable() {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const testKey = '__storage_test__';
    storage.setItem(testKey, '1');
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

// ==========================================
// Settings
// ==========================================

export function loadClientSettings() {
  const saved = getItem(STORAGE_KEYS.SETTINGS, null, LEGACY_STORAGE_KEYS.SETTINGS);
  if (!saved || typeof saved !== 'object') {
    return null;
  }
  return { ...DEFAULT_SETTINGS, ...saved };
}

export function saveClientSettings(settings) {
  return setItem(STORAGE_KEYS.SETTINGS, settings);
}

// ==========================================
// Printer Profiles
// ==========================================

export function loadAllClientPrinterProfiles() {
  const profiles = getItem(STORAGE_KEYS.PRINTER_PROFILES, {}, LEGACY_STORAGE_KEYS.PRINTER_PROFILES);
  return profiles && typeof profiles === 'object' ? profiles : {};
}

export function loadClientPrinterProfile(macAddress) {
  if (!macAddress) return null;
  const profiles = loadAllClientPrinterProfiles();
  return profiles[macAddress.toUpperCase()] || null;
}

export function saveClientPrinterProfile(macAddress, profile) {
  if (!macAddress) return false;
  const profiles = loadAllClientPrinterProfiles();
  profiles[macAddress.toUpperCase()] = {
    ...profiles[macAddress.toUpperCase()],
    ...profile,
    mac_address: macAddress,
    updated_at: new Date().toISOString(),
  };
  return setItem(STORAGE_KEYS.PRINTER_PROFILES, profiles);
}

// ==========================================
// Projects & Categories
// ==========================================

export function loadClientProjects() {
  const projects = getItem(STORAGE_KEYS.PROJECTS, null, LEGACY_STORAGE_KEYS.PROJECTS);
  return Array.isArray(projects) ? projects : null;
}

export function saveClientProjects(projects) {
  return setItem(STORAGE_KEYS.PROJECTS, Array.isArray(projects) ? projects : []);
}

export function loadClientCategories() {
  const categories = getItem(STORAGE_KEYS.CATEGORIES, null, LEGACY_STORAGE_KEYS.CATEGORIES);
  return Array.isArray(categories) ? categories : null;
}

export function saveClientCategories(categories) {
  return setItem(STORAGE_KEYS.CATEGORIES, Array.isArray(categories) ? categories : []);
}

// ==========================================
// Custom Presets
// ==========================================

export function loadClientCustomPresets() {
  const presets = getItem(STORAGE_KEYS.CUSTOM_PRESETS, [], LEGACY_STORAGE_KEYS.CUSTOM_PRESETS);
  return Array.isArray(presets) ? presets : [];
}

export function saveClientCustomPresets(presets) {
  return setItem(STORAGE_KEYS.CUSTOM_PRESETS, Array.isArray(presets) ? presets : []);
}

// ==========================================
// RFID Presets (Barcode -> Preset mapping)
// ==========================================

export function loadClientRfidPresets() {
  const map = getItem(STORAGE_KEYS.RFID_PRESETS, {}, LEGACY_STORAGE_KEYS.RFID_PRESETS);
  return (map && typeof map === 'object') ? map : {};
}

export function saveClientRfidPreset(barcodeOrUuid, presetIdOrData) {
  const current = loadClientRfidPresets();
  current[barcodeOrUuid] = presetIdOrData;
  return setItem(STORAGE_KEYS.RFID_PRESETS, current);
}

// ==========================================
// Addresses
// ==========================================

export function loadClientAddresses() {
  const addresses = getItem(STORAGE_KEYS.ADDRESSES, null, LEGACY_STORAGE_KEYS.ADDRESSES);
  return Array.isArray(addresses) ? addresses : null;
}

export function saveClientAddresses(addresses) {
  return setItem(STORAGE_KEYS.ADDRESSES, Array.isArray(addresses) ? addresses : []);
}

// ==========================================
// Workspace Backup / Export / Import
// ==========================================

export function exportAllClientData() {
  const data = {
    version: 1,
    exported_at: new Date().toISOString(),
    settings: loadClientSettings() || DEFAULT_SETTINGS,
    printer_profiles: loadAllClientPrinterProfiles(),
    projects: loadClientProjects() || [],
    categories: loadClientCategories() || [],
    custom_presets: loadClientCustomPresets() || [],
    addresses: loadClientAddresses() || [],
  };
  return JSON.stringify(data, null, 2);
}

export function importAllClientData(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid JSON data format');
    }

    if (data.settings && typeof data.settings === 'object') {
      saveClientSettings(data.settings);
    }
    if (data.printer_profiles && typeof data.printer_profiles === 'object') {
      setItem(STORAGE_KEYS.PRINTER_PROFILES, data.printer_profiles);
    }
    if (Array.isArray(data.projects)) {
      saveClientProjects(data.projects);
    }
    if (Array.isArray(data.categories)) {
      saveClientCategories(data.categories);
    }
    if (Array.isArray(data.custom_presets)) {
      saveClientCustomPresets(data.custom_presets);
    }
    if (Array.isArray(data.addresses)) {
      saveClientAddresses(data.addresses);
    }

    return {
      success: true,
      projectCount: Array.isArray(data.projects) ? data.projects.length : 0,
      categoryCount: Array.isArray(data.categories) ? data.categories.length : 0,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
