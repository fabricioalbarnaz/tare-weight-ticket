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
  /**
   * How long after a same-plate, same-direction camera reading to discard
   * any further reading for that exact plate/direction pair — see
   * docs/plans/2026-11-12-camera-duplicate-plate-debounce-plan.md. Distinct
   * from `postReleaseDebounceMs`: this one is plate- and direction-scoped
   * (two entrances, or two exits, for the *same* plate), not global.
   */
  duplicatePlateDebounceMs: number;
}

export function loadCameraConfig(env: NodeJS.ProcessEnv = process.env): CameraConfig {
  return {
    postReleaseDebounceMs: parsePositiveInt(
      'CAMERA_POST_RELEASE_DEBOUNCE_MS',
      env.CAMERA_POST_RELEASE_DEBOUNCE_MS,
      15000,
    ),
    duplicatePlateDebounceMs: parsePositiveInt(
      'CAMERA_DUPLICATE_PLATE_DEBOUNCE_MS',
      env.CAMERA_DUPLICATE_PLATE_DEBOUNCE_MS,
      120000,
    ),
  };
}
