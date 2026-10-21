import { drawBundlesFirst, nestBundles, skipBundlesFor } from "../bundle";
import type { Diagnostics } from "../diagnostics";
import { applyDynamicLighting } from "../lamps";
import { watchGpuErrors } from "../renderer";

/**
 * Prepares a new renderer before init: the bundle patches, and dynamic
 * lighting for up to `dynamicLights` lights when that is above 0.
 */
export const patchRenderer = (renderer: unknown, dynamicLights: number) => {
  nestBundles(renderer);
  skipBundlesFor(renderer);
  drawBundlesFirst(renderer);
  if (dynamicLights) applyDynamicLighting(renderer, dynamicLights);
};

// Distinct GPU errors reported per scene, at most.
const MAX_GPU_ERRORS = 20;

/**
 * Logs each distinct GPU error of `renderer` once, to the console and to
 * `diagnostics`. A pipeline the GPU rejects draws nothing, so these errors
 * are otherwise invisible.
 */
export const reportGpuErrors = (renderer: unknown, diagnostics: Diagnostics) => {
  const seen = new Set<string>();
  watchGpuErrors(renderer, (message) => {
    if (seen.has(message) || seen.size >= MAX_GPU_ERRORS) return;
    seen.add(message);
    diagnostics.note("gpu error", { message: message.slice(0, 1000) });
    console.error("[apricot] GPU error:", message);
  });
};
