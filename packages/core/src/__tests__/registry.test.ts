import { describe, expect, it } from "vitest";
import { SceneRegistry } from "../registry";

const fakeScene = () => ({
  detached: 0,
  detach() {
    this.detached++;
  },
});

describe("SceneRegistry", () => {
  it("shares a scene by id and disposes it with its last user", () => {
    const registry = new SceneRegistry<ReturnType<typeof fakeScene>>();
    const a = registry.acquire("hero", fakeScene);
    const b = registry.acquire("hero", fakeScene);
    expect(b.scene).toBe(a.scene);
    registry.release("hero");
    expect(a.scene.detached).toBe(0);
    registry.release("hero");
    expect(a.scene.detached).toBe(1);
    expect(registry.size).toBe(0);
  });

  it("gives anonymous scenes unique ids", () => {
    const registry = new SceneRegistry<ReturnType<typeof fakeScene>>();
    const a = registry.acquire(undefined, fakeScene);
    const b = registry.acquire(undefined, fakeScene);
    expect(a.id).not.toBe(b.id);
    expect(a.scene).not.toBe(b.scene);
  });
});
