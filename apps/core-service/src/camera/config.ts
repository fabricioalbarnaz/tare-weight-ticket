import { parsePositiveInt } from '../config/env.js';

export interface CameraConfig {
  /**
   * How long after the most recently closed ticket to discard any camera
   * webhook outright, regardless of which plate it reports — see
   * docs/plans/2026-11-03-camera-post-release-debounce-plan.md. Guards
   * against a released truck rolling back slightly and re-triggering a
   * camera, which then reads the *other* plate of the same articulated
   * rig (tractor vs. trailer) rather than a duplicate of the same plate.
   */
  postReleaseDebounceMs: number;
}

export function loadCameraConfig(env: NodeJS.ProcessEnv = process.env): CameraConfig {
  return {
    postReleaseDebounceMs: parsePositiveInt(
      'CAMERA_POST_RELEASE_DEBOUNCE_MS',
      env.CAMERA_POST_RELEASE_DEBOUNCE_MS,
      15000,
    ),
  };
}
