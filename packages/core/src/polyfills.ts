// Hermes has TextEncoder but no TextDecoder, which three's loaders need.
// Imported first by the package entry so it runs before three is evaluated.
import "fast-text-encoding";
