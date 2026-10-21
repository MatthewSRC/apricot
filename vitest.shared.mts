// Shared Vitest settings. Coverage is enforced per package in CI.
export const coverage = {
  provider: "v8" as const,
  include: ["src/**"],
  exclude: ["src/**/__tests__/**", "src/**/*.d.ts"],
  reporter: ["text", "json-summary"],
  thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
};
