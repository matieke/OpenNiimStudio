import { describe, expect, test, beforeEach } from 'vitest';
import {
  isClientStorageAvailable,
  loadClientSettings,
  saveClientSettings,
  loadClientPrinterProfile,
  saveClientPrinterProfile,
  loadClientProjects,
  saveClientProjects,
  exportAllClientData,
  importAllClientData,
  DEFAULT_SETTINGS
} from './clientStorage';

describe('clientStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('reports storage availability', () => {
    expect(isClientStorageAvailable()).toBe(true);
  });

  test('saves and loads client settings', () => {
    expect(loadClientSettings()).toBeNull();

    const customSettings = {
      ...DEFAULT_SETTINGS,
      paper_width_mm: 40.0,
      default_dpi: 300,
    };
    saveClientSettings(customSettings);

    const loaded = loadClientSettings();
    expect(loaded.paper_width_mm).toBe(40.0);
    expect(loaded.default_dpi).toBe(300);
  });

  test('saves and loads printer profiles per MAC', () => {
    expect(loadClientPrinterProfile('AA:BB:CC:DD:EE:FF')).toBeNull();

    saveClientPrinterProfile('AA:BB:CC:DD:EE:FF', {
      energy: 5,
      speed: 2,
      paper_mode: 'continuous',
    });

    const profile = loadClientPrinterProfile('aa:bb:cc:dd:ee:ff');
    expect(profile).toBeDefined();
    expect(profile.energy).toBe(5);
    expect(profile.speed).toBe(2);
  });

  test('saves and loads projects', () => {
    expect(loadClientProjects()).toBeNull();

    const sampleProjects = [
      { id: 'p1', name: 'Shipping Label', canvas_state_json: '{}' },
    ];
    saveClientProjects(sampleProjects);

    const loaded = loadClientProjects();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Shipping Label');
  });

  test('exports and imports all client data as JSON', () => {
    saveClientSettings({ ...DEFAULT_SETTINGS, paper_width_mm: 75.0 });
    saveClientProjects([{ id: 'p2', name: 'Barcode Tag', canvas_state_json: '{"items":[]}' }]);

    const exportedJson = exportAllClientData();
    expect(exportedJson).toContain('Barcode Tag');

    window.localStorage.clear();
    expect(loadClientProjects()).toBeNull();

    const importResult = importAllClientData(exportedJson);
    expect(importResult.success).toBe(true);
    expect(importResult.projectCount).toBe(1);

    const reloadedProjects = loadClientProjects();
    expect(reloadedProjects[0].name).toBe('Barcode Tag');
    const reloadedSettings = loadClientSettings();
    expect(reloadedSettings.paper_width_mm).toBe(75.0);
  });

  test('migrates legacy catlabel_ keys seamlessly to openniim_ keys', () => {
    // Seed legacy keys
    window.localStorage.setItem('catlabel_client_settings', JSON.stringify({
      paper_width_mm: 50.0,
      intended_media_type: 'pre-cut',
    }));
    window.localStorage.setItem('catlabel_client_projects', JSON.stringify([
      { id: 'legacy-1', name: 'Legacy Label' },
    ]));

    // Reading via OpenNiimStorage
    const settings = loadClientSettings();
    expect(settings.paper_width_mm).toBe(50.0);
    expect(settings.intended_media_type).toBe('pre-cut');

    const projects = loadClientProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Legacy Label');

    // Verify migrated into openniim_ key
    expect(window.localStorage.getItem('openniim_client_settings')).toBeDefined();
    expect(window.localStorage.getItem('openniim_client_projects')).toBeDefined();
  });
});
