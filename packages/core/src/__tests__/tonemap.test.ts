import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { agxToneMap, untoneMapped } from "../tonemap";

const shown = (color: THREE.Color, exposure = 1) =>
  new THREE.Color().setRGB(...agxToneMap([color.r, color.g, color.b], exposure)).getHexString();

describe("untoneMapped", () => {
  it("matches three's AgX: white shows light grey unless compensated", () => {
    // What three draws for a #ffffff background with AgX.
    expect(shown(new THREE.Color("#ffffff"))).toBe("cacaca");
  });

  it("finds the colour that shows as the one asked for", () => {
    for (const hex of ["#ffffff", "#f6efe6", "#eceff3", "#14161b", "#3a7bd5"]) {
      const target = new THREE.Color(hex);
      const drawn = untoneMapped(target, THREE.AgXToneMapping);
      const back = new THREE.Color(`#${shown(drawn)}`);
      for (const channel of ["r", "g", "b"] as const) {
        expect(Math.abs(back[channel] - target[channel])).toBeLessThan(2 / 255);
      }
    }
    // With exposure too.
    const target = new THREE.Color("#eceff3");
    expect(shown(untoneMapped(target, THREE.AgXToneMapping, 2), 2)).toBe("eceff3");
    // Black stays black; colours AgX cannot show come as close as it allows.
    expect(untoneMapped(new THREE.Color("#000000"), THREE.AgXToneMapping).getHex()).toBe(0);
    expect(shown(untoneMapped(new THREE.Color("#ff0000"), THREE.AgXToneMapping))).toMatch(/^ff/);
  });

  it("leaves colours as they are without AgX", () => {
    const color = new THREE.Color("#ffffff");
    const out = new THREE.Color();
    expect(untoneMapped(color, THREE.NoToneMapping, 1, out)).toBe(out);
    expect(out.getHexString()).toBe("ffffff");
  });
});
