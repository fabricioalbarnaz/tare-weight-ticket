import { describe, expect, it } from 'vitest';
import { loadCameraConfig } from './config.js';

describe('loadCameraConfig', () => {
  it('falls back to the default when no env var is set', () => {
    expect(loadCameraConfig({})).toEqual({ postReleaseDebounceMs: 15000 });
  });

  it('reads the value from the given env', () => {
    expect(loadCameraConfig({ CAMERA_POST_RELEASE_DEBOUNCE_MS: '5000' })).toEqual({
      postReleaseDebounceMs: 5000,
    });
  });

  it('throws when the env var is not a positive integer', () => {
    expect(() => loadCameraConfig({ CAMERA_POST_RELEASE_DEBOUNCE_MS: 'nope' })).toThrow(
      /CAMERA_POST_RELEASE_DEBOUNCE_MS/,
    );
    expect(() => loadCameraConfig({ CAMERA_POST_RELEASE_DEBOUNCE_MS: '0' })).toThrow(
      /CAMERA_POST_RELEASE_DEBOUNCE_MS/,
    );
  });
});
