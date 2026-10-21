import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { readTexture, readWebGL, shrinkPixels } from "../capture";
import { encodePng } from "../png";
import { ApricotScene } from "../scene";
import { fakeContext, fakeRenderer, manualScheduler } from "./helpers";
import { chunksOf, decodePng } from "./png";

/** A GPU device that copies `bytes` (rows padded to 256) into the buffer read back. */
const fakeDevice = (bytes: Uint8Array) => {
  const log: string[] = [];
  const device = {
    createBuffer: ({ size }: { size: number }) => {
      const memory = new ArrayBuffer(size);
      new Uint8Array(memory).set(bytes.subarray(0, size));
      return {
        mapAsync: async () => {
          log.push("map");
        },
        getMappedRange: () => memory,
        unmap: () => log.push("unmap"),
        destroy: () => log.push("destroy"),
      };
    },
    createCommandEncoder: () => ({
      copyTextureToBuffer: (_from: unknown, to: { bytesPerRow: number }, size: { width: number }) =>
        log.push(`copy ${size.width} ${to.bytesPerRow}`),
      finish: () => "commands",
    }),
    queue: { submit: () => log.push("submit") },
  };
  return { device: device as unknown as GPUDevice, log };
};

/** Two pixels a row, two rows, padded to 256 bytes a row as a GPU copy is. */
const padded = (rows: number[][]) => {
  const bytes = new Uint8Array(256 * rows.length);
  for (const [y, row] of rows.entries()) bytes.set(row, y * 256);
  return bytes;
};

describe("reading a frame back", () => {
  it("reads a texture's pixels as RGBA rows, whatever order the screen keeps them in", async () => {
    const rows = [
      [10, 20, 30, 255, 40, 50, 60, 255],
      [70, 80, 90, 255, 100, 110, 120, 255],
    ];
    const { device, log } = fakeDevice(padded(rows));
    const rgba = await readTexture(device, { width: 2, height: 2, format: "rgba8unorm" } as GPUTexture);
    expect([...rgba.data]).toEqual(rows.flat());
    expect(log).toEqual(["copy 2 256", "submit", "map", "unmap", "destroy"]);
    // Blue first (most Android and iOS screens): swapped back.
    const bgra = await readTexture(fakeDevice(padded(rows)).device, {
      width: 2,
      height: 2,
      format: "bgra8unorm",
    } as GPUTexture);
    expect([...bgra.data.subarray(0, 4)]).toEqual([30, 20, 10, 255]);
  });

  it("undoes premultiplied alpha (a see-through scene)", async () => {
    const { device } = fakeDevice(padded([[50, 25, 0, 128, 0, 0, 0, 0]]));
    const pixels = await readTexture(device, { width: 2, height: 1, format: "rgba8unorm" } as GPUTexture);
    expect([...pixels.data]).toEqual([100, 50, 0, 128, 0, 0, 0, 0]);
  });

  it("reads a WebGL frame as RGBA rows from the top, keeping the context's bindings", () => {
    // WebGL rows start at the bottom.
    const bottomUp = [50, 25, 0, 128, 0, 0, 0, 0, 10, 20, 30, 255, 40, 50, 60, 255];
    const calls: string[] = [];
    const gl = {
      drawingBufferWidth: 2,
      drawingBufferHeight: 2,
      READ_FRAMEBUFFER: "read",
      READ_FRAMEBUFFER_BINDING: "read binding",
      PIXEL_PACK_BUFFER: "pack",
      PIXEL_PACK_BUFFER_BINDING: "pack binding",
      getParameter: (name: string) => `${name} before`,
      bindFramebuffer: (target: string, to: unknown) => calls.push(`${target} ${to}`),
      bindBuffer: (target: string, to: unknown) => calls.push(`${target} ${to}`),
      readPixels: (
        _x: number,
        _y: number,
        _w: number,
        _h: number,
        _f: unknown,
        _t: unknown,
        out: Uint8Array,
      ) => {
        calls.push("read");
        out.set(bottomUp);
      },
    } as unknown as WebGL2RenderingContext;
    const pixels = readWebGL(gl);
    expect([pixels.width, pixels.height]).toEqual([2, 2]);
    expect([...pixels.data]).toEqual([10, 20, 30, 255, 40, 50, 60, 255, 100, 50, 0, 128, 0, 0, 0, 0]);
    expect(calls).toEqual([
      "read null",
      "pack null",
      "read",
      "read read binding before",
      "pack pack binding before",
    ]);
  });

  it("shrinks pixels to fit, keeping their shape, each the average of those it covers", () => {
    // 4 × 2: left half black, right half white.
    const data = new Uint8Array(4 * 2 * 4);
    for (let i = 0; i < 8; i++) data.set(i % 4 < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
    const small = shrinkPixels({ width: 4, height: 2, data }, 2, 2);
    expect([small.width, small.height]).toEqual([2, 1]);
    expect([...small.data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    // Never larger.
    const same = { width: 4, height: 2, data };
    expect(shrinkPixels(same, 100, 100)).toBe(same);
    // Odd sizes: every pixel covered, none twice.
    const third = shrinkPixels({ width: 4, height: 2, data }, 3, 3);
    expect([third.width, third.height]).toEqual([3, 2]);
  });
});

describe("encodePng", () => {
  it("writes a PNG that gives the same pixels back: RGB when opaque, RGBA when not", () => {
    const data = new Uint8Array(3 * 2 * 4);
    for (let i = 0; i < 6; i++) data.set([i * 40, 255 - i * 40, (i * 97) % 256, 255], i * 4);
    const file = encodePng({ width: 3, height: 2, data });
    expect([...file.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(chunksOf(file).map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(chunksOf(file)[0].body[9]).toBe(2);
    expect([...decodePng(file).data]).toEqual([...data]);
    // See-through: RGBA.
    data[3] = 0;
    const clear = encodePng({ width: 3, height: 2, data }, { effort: 1 });
    expect(chunksOf(clear)[0].body[9]).toBe(6);
    expect([...decodePng(clear).data]).toEqual([...data]);
  });
});

describe("ApricotScene.capture", () => {
  const size = { width: 2, height: 1, devicePixelRatio: 1 };
  /** A few frames, letting promises settle between them. */
  const frames = async (s: ReturnType<typeof manualScheduler>) => {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      s.step();
    }
  };

  it("reads the next frame drawn, before it is presented, once the scene is ready", async () => {
    const s = manualScheduler();
    const { device } = fakeDevice(padded([[1, 2, 3, 255, 4, 5, 6, 255]]));
    const renderer = Object.assign(fakeRenderer(), { backend: { device } });
    const scene = new ApricotScene({ scheduler: s.scheduler, createRenderer: () => renderer, warmUp: false });
    const order: string[] = [];
    const texture = { width: 2, height: 1, format: "rgba8unorm" };
    const context = Object.assign(fakeContext(), {
      getCurrentTexture: () => {
        order.push("read");
        return texture;
      },
    });
    const present = context.present;
    context.present = () => {
      order.push("present");
      return present();
    };
    await expect(scene.capture()).rejects.toThrow(/not on screen/);
    await scene.attach(context as never, size);
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));
    await frames(s);
    const capture = scene.capture();
    await frames(s);
    const pixels = await capture;
    expect([...pixels.data]).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    // Read from the frame just drawn, before it was presented: once.
    expect(order.filter((o) => o === "read")).toHaveLength(1);
    expect(order[order.indexOf("read") + 1]).toBe("present");
  });

  it("fails without a GPU device to read from, and when the scene leaves the screen", async () => {
    const s = manualScheduler();
    const scene = new ApricotScene({
      scheduler: s.scheduler,
      createRenderer: () => fakeRenderer(),
      warmUp: false,
    });
    await scene.attach(fakeContext() as never, size);
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));
    await frames(s);
    const noDevice = expect(scene.capture()).rejects.toThrow(/no GPU device/);
    await frames(s);
    await noDevice;
    const left = scene.capture();
    await Promise.resolve();
    scene.detach();
    await expect(left).rejects.toThrow(/left the screen/);
  });
});
