// Apricot recipe: falling-pile
// Copy this file into your app. Wrap any screen's content with it, and 3D objects drop over it for
// `duration` seconds and pile up at the bottom. Touches go through to the screen below, and the 3D layer
// stops rendering once the pile has settled.
import { Pile, type PileProps, Scene } from "@apricotjs/react-native";
import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

export interface FallingPileOverlayProps extends Omit<PileProps, "children"> {
  /** The screen the objects fall over. */
  children: ReactNode;
  /** What to drop, such as <Apple />. */
  items: ReactNode;
  style?: ViewStyle;
  /** Shows the frame rate and render time overlay. */
  debug?: boolean;
}

export function FallingPileOverlay({ children, items, style, debug, ...pile }: FallingPileOverlayProps) {
  return (
    <View style={[{ flex: 1 }, style]}>
      {children}
      {/* A narrow field of view keeps objects round near the screen edges. */}
      <Scene
        transparent
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        camera={{ position: [0, 0, 20], fov: 30 }}
        debug={debug}
      >
        <Pile scale={[0.58, 0.68]} {...pile}>
          {items}
        </Pile>
      </Scene>
    </View>
  );
}
