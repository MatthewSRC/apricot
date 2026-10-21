import { describe, expect, it } from "vitest";
import { Trip } from "../trip";

describe("Trip", () => {
  // 0 → 1000 m: accelerate 1 m/s² to 20 m/s (200 m, 20 s), cruise 600 m (30 s), brake (200 m, 20 s).
  const line = (options = {}) =>
    new Trip({ stops: [0, 1000, 1500], speed: 20, acceleration: 1, dwell: 10, ...options });

  it("waits at the first stop, then speeds up, cruises and brakes onto the next stop", () => {
    const trip = line();
    expect(trip.at(0)).toMatchObject({ distance: 0, stopped: true, stop: 0, nextStop: 1, eta: 10 });
    const accelerating = trip.at(20);
    expect(accelerating.distance).toBeCloseTo(50);
    expect(accelerating.speed).toBeCloseTo(10);
    expect(trip.at(45)).toMatchObject({ speed: 20, stopped: false });
    expect(trip.at(45).distance).toBeCloseTo(200 + 15 * 20);
    // Arrives exactly at 70 s of motion, 80 s in.
    expect(trip.at(79.999).distance).toBeCloseTo(1000, 2);
    expect(trip.at(60).eta).toBeCloseTo(20);
    expect(trip.at(81)).toMatchObject({ distance: 1000, stopped: true, stop: 1, nextStop: 2 });
  });

  it("uses a shorter, triangular profile when the stops are too close for top speed", () => {
    const trip = line();
    // 1000 → 1500: peak sqrt(500) ≈ 22.4 > 20? No: 500 m needs 400 m to reach 20 m/s and stop, so it cruises 100 m.
    const short = new Trip({ stops: [0, 100], speed: 20, acceleration: 1, dwell: 0, pattern: "once" });
    expect(short.at(10).speed).toBeCloseTo(10); // peak sqrt(100) = 10 at 10 s
    expect(short.at(20).distance).toBeCloseTo(100);
    expect(trip.period).toBeGreaterThan(0);
  });

  it("shuttles back along the stops, facing the other way", () => {
    const trip = line();
    const back = trip.at(trip.period - 30);
    expect(back.direction).toBe(-1);
    expect(back.nextStop).toBe(0);
    // A whole cycle later it is where it started.
    expect(trip.at(trip.period + 5).distance).toBeCloseTo(trip.at(5).distance);
  });

  it("loops round a closed path, and stops for good on a one-way trip", () => {
    const loop = new Trip({ stops: [100, 600], length: 1000, pattern: "loop", dwell: 0, acceleration: 1 });
    // The second leg runs from 600 past the end (1000) round to 100 (= 1100).
    const late = loop.at(loop.period - 1);
    expect(late.distance).toBeLessThan(100);
    expect(late.nextStop).toBe(0);
    const once = line({ pattern: "once" });
    expect(once.period).toBe(Number.POSITIVE_INFINITY);
    expect(once.at(10_000)).toMatchObject({ distance: 1500, stopped: true, stop: 2, eta: 0 });
    expect(once.at(-5).distance).toBe(0);
  });

  it("checks its options", () => {
    expect(() => new Trip({ stops: [0] })).toThrow(/two stops/);
    expect(() => new Trip({ stops: [0, 10], pattern: "loop" })).toThrow(/path length/);
  });
});
