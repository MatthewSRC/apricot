import { expect, it } from "vitest";
import * as capture from "../capture";
import * as apricot from "../index";
import * as model from "../Model";
import * as mock from "../mock";

// Exports that only the mock has.
const MOCK_ONLY = ["mockScene"];

it("mocks everything @apricotjs/react-native, /model and /capture export, and nothing else but its own", () => {
  const real = [...new Set([...Object.keys(apricot), ...Object.keys(model), ...Object.keys(capture)])];
  expect(Object.keys(mock).sort()).toEqual([...real, ...MOCK_ONLY].sort());
});
