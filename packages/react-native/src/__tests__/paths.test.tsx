import type { Path } from "@apricotjs/core";
import { act } from "@testing-library/react";
import { createRef, useEffect } from "react";
import { Text } from "react-native";
import * as THREE from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FollowPath, type TripHandle, type UseTripOptions, usePath, useTrip, useTripStatus } from "../paths";
import { renderScene, stepFrames } from "./render";
import { sharedValue } from "./setup";

afterEach(() => {
  vi.useRealTimers();
});

/** A clock the test moves by hand. */
const manualClock = () => {
  const clock = { now: 100, read: () => clock.now };
  return clock;
};

// A straight 1 km line along +x with stops at 0 and 1000.
const POINTS: [number, number, number][] = [
  [0, 0, 0],
  [1000, 0, 0],
];

function Line({
  options,
  onPath,
  onTrip,
  offsets = [0],
  status,
}: {
  options: Omit<UseTripOptions, "path">;
  onPath?: (path: Path) => void;
  onTrip?: (trip: TripHandle) => void;
  offsets?: number[];
  status?: boolean;
}) {
  const path = usePath(POINTS);
  const trip = useTrip({ path, ...options });
  useEffect(() => {
    onPath?.(path);
    onTrip?.(trip);
  });
  return (
    <>
      {offsets.map((o) => (
        <FollowPath key={o} path={path} trip={trip}>
          <group-marker offset={o} />
        </FollowPath>
      ))}
      {status ? <Status trip={trip} /> : null}
    </>
  );
}

function Status({ trip }: { trip: TripHandle }) {
  const s = useTripStatus(trip);
  return <Text>{`${s.stopped ? "at" : "to"} ${s.stopped ? s.stop : s.nextStop} in ${s.seconds}`}</Text>;
}

declare global {
  namespace React.JSX {
    interface IntrinsicElements {
      "group-marker": { offset: number };
    }
  }
}

describe("useTrip and <FollowPath>", () => {
  it("waits, leaves, runs and arrives on the clock, telling the app", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const clock = manualClock();
    const onArrive = vi.fn();
    const onDepart = vi.fn();
    const car = createRef<THREE.Group>();
    // The trip lives outside <Scene>, next to the UI, as in an app.
    let handle: TripHandle | null = null;
    function Rider({ trip }: { trip: TripHandle }) {
      const path = usePath(POINTS);
      return <FollowPath ref={car} path={path} trip={trip} offset={-10} />;
    }
    function App({ children }: { children: (trip: TripHandle) => React.ReactNode }) {
      const path = usePath(POINTS);
      const trip = useTrip({
        path,
        stops: [0, 1000],
        speed: 20,
        acceleration: 1,
        dwell: 10,
        clock: clock.read,
        onArrive,
        onDepart,
      });
      handle = trip;
      return <>{children(trip)}</>;
    }
    const advance = async (seconds: number) => {
      clock.now += seconds;
      await act(async () => {
        vi.advanceTimersByTime(seconds * 1000);
      });
    };
    const { render } = await import("@testing-library/react");
    const { Scene } = await import("../Scene");
    render(
      <App>
        {(trip) => (
          <Scene linger={0}>
            <Rider trip={trip} />
          </Scene>
        )}
      </App>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    await stepFrames(1);
    // Waiting at the first stop; the offset puts this car 10 m behind.
    expect(car.current?.position.x).toBeCloseTo(0, 3);
    await advance(30); // 20 s after leaving: 200 m covered
    await stepFrames(1);
    expect(onDepart).toHaveBeenCalledWith(0);
    expect(car.current?.position.x).toBeCloseTo(190, 0);
    // Facing along the line (+x).
    expect(
      new THREE.Vector3(0, 0, 1).applyQuaternion(car.current?.quaternion as THREE.Quaternion).x,
    ).toBeCloseTo(1);
    await advance(55); // 85 s: arrived at 80, waiting until 90
    await stepFrames(1);
    expect(onArrive).toHaveBeenCalledWith(1);
    expect(car.current?.position.x).toBeCloseTo(990, 0);
    expect((handle as unknown as TripHandle).state().stopped).toBe(true);
    // After a long sleep (the timer fires late, at 185 s: back at stop 0 and departed again), it reports
    // the missed events in order.
    onArrive.mockClear();
    onDepart.mockClear();
    clock.now += 100;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onDepart.mock.calls).toEqual([[1], [0]]);
    expect(onArrive).toHaveBeenCalledWith(0);
  });

  it("sleeps while stopped and wakes for departure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const clock = manualClock();
    let handle: TripHandle | null = null;
    const view = await renderScene(
      <Line options={{ stops: [0, 1000], dwell: 5, clock: clock.read }} onTrip={(t) => (handle = t)} />,
    );
    const invalidate = vi.spyOn(view.scene, "invalidate");
    await stepFrames(1);
    expect((handle as unknown as TripHandle).state().stopped).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(5100);
    });
    expect(invalidate).toHaveBeenCalled();
    view.unmount();
  });

  it("counts down for the UI every second, also while the scene sleeps", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const clock = manualClock();
    const view = await renderScene(
      <Line options={{ stops: [0, 1000], dwell: 5, clock: clock.read }} status />,
    );
    expect(view.getByText("at 0 in 5")).toBeTruthy();
    clock.now += 2;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(view.getByText("at 0 in 3")).toBeTruthy();
    // When nothing changed, it keeps the same state object and does not re-render.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(view.getByText("at 0 in 3")).toBeTruthy();
    clock.now += 10;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(view.getByText(/^to 1 in/)).toBeTruthy();
  });

  it("starts part-way through a timetable and runs loops on closed paths", async () => {
    const clock = manualClock();
    const car = createRef<THREE.Group>();
    function Ring() {
      const path = usePath(
        [
          [10, 0, 0],
          [0, 0, 10],
          [-10, 0, 0],
          [0, 0, -10],
        ],
        { closed: true },
      );
      const trip = useTrip({ path, stops: [0, 20], pattern: "loop", dwell: 0, clock: clock.read, start: 3 });
      return <FollowPath ref={car} path={path} trip={trip} />;
    }
    await renderScene(<Ring />);
    await stepFrames(1);
    // 3 s in at 1.2 m/s²: 5.4 m along the ring.
    expect(car.current?.position.distanceTo(new THREE.Vector3(10, 0, 0))).toBeGreaterThan(4);
  });

  it("follows a plain or shared distance without a trip, optionally without turning", async () => {
    const along = sharedValue(250);
    const car = createRef<THREE.Group>();
    function Rider({ orient }: { orient: boolean }) {
      const path = usePath(POINTS);
      return <FollowPath ref={car} path={path} distance={along as never} orient={orient} />;
    }
    const view = await renderScene(<Rider orient />);
    await stepFrames(1);
    expect(car.current?.position.x).toBeCloseTo(250, 3);
    await act(async () => {
      along.value = 600;
    });
    view.update(<Rider orient={false} />);
    await stepFrames(1);
    expect(car.current?.position.x).toBeCloseTo(600, 3);
    expect(car.current?.quaternion.equals(new THREE.Quaternion())).toBe(false);
  });

  it("keeps the same path and trip across renders", async () => {
    const paths: Path[] = [];
    const trips: TripHandle[] = [];
    const options = { stops: [0, 1000] };
    const view = await renderScene(
      <Line options={options} onPath={(p) => paths.push(p)} onTrip={(t) => trips.push(t)} />,
    );
    view.update(
      <Line options={{ ...options }} onPath={(p) => paths.push(p)} onTrip={(t) => trips.push(t)} />,
    );
    expect(paths[0]).toBe(paths[paths.length - 1]);
    expect(trips[0]).toBe(trips[trips.length - 1]);
  });
});
