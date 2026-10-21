import { describe, expect, it } from "vitest";
import { ArcadeVehicle } from "../vehicle";

const drive = (car: ArcadeVehicle, seconds: number, throttle: number, steer = 0, dt = 1 / 60) => {
  let moving = true;
  for (let t = 0; t < seconds - 1e-9; t += dt) moving = car.step(dt, { throttle, steer });
  return moving;
};

describe("ArcadeVehicle", () => {
  it("accelerates forwards (+z) up to top speed and coasts to a stop", () => {
    const car = new ArcadeVehicle({ maxSpeed: 10, acceleration: 5, drag: 4 });
    drive(car, 1, 1);
    expect(car.state.speed).toBeCloseTo(5, 1);
    drive(car, 5, 1);
    expect(car.state.speed).toBe(10);
    expect(car.state.z).toBeGreaterThan(20);
    expect(Math.abs(car.state.x)).toBeLessThan(1e-9);
    expect(car.state.wheelSpin).toBeGreaterThan(0);
    expect(drive(car, 3, 0)).toBe(false);
    expect(car.state.speed).toBe(0);
  });

  it("brakes, then reverses up to the reverse limit", () => {
    const car = new ArcadeVehicle({ maxReverse: 3, braking: 30 });
    drive(car, 1, 1);
    const before = car.state.speed;
    car.step(1 / 60, { throttle: -1, steer: 0 });
    expect(car.state.speed).toBeCloseTo(before - 0.5, 5);
    drive(car, 5, -1);
    expect(car.state.speed).toBe(-3);
  });

  it("turns right for positive steer (towards -x when facing +z) and narrows steering at speed", () => {
    const car = new ArcadeVehicle();
    drive(car, 2, 1, 1);
    expect(car.state.x).toBeLessThan(-0.5);
    expect(car.state.heading).toBeLessThan(0);
    const slowSteer = new ArcadeVehicle();
    drive(slowSteer, 0.3, 0.2, 1);
    expect(Math.abs(slowSteer.state.steer)).toBeGreaterThan(Math.abs(car.state.steer));
    // Left goes the other way.
    const left = new ArcadeVehicle();
    drive(left, 2, 1, -1);
    expect(left.state.x).toBeGreaterThan(0.5);
  });

  it("centres the wheels when released, even when standing still", () => {
    const car = new ArcadeVehicle();
    expect(drive(car, 0.5, 0, 1)).toBe(true);
    expect(car.state.steer).toBeGreaterThan(0.3);
    expect(drive(car, 3, 0, 0)).toBe(false);
    expect(car.state.steer).toBe(0);
  });

  it("stops at its bounds, starts where told, and ignores bad input and empty steps", () => {
    const car = new ArcadeVehicle({ bounds: [-5, -5, 5, 5] }, { x: 1, z: 2, heading: Math.PI / 2 });
    expect([car.state.x, car.state.z, car.state.heading]).toEqual([1, 2, Math.PI / 2]);
    drive(car, 5, 1);
    expect(car.state.x).toBe(5);
    expect(car.state.speed).toBe(0);
    expect(car.step(0, { throttle: 1, steer: 0 })).toBe(false);
    car.step(1 / 60, { throttle: Number.NaN, steer: Number.POSITIVE_INFINITY });
    expect(car.state.speed).toBe(0);
    expect(car.state.steer).toBe(0);
  });
});
