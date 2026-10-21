import { Box, Scene, Spin } from "@apricotjs/react-native";
import { SceneLoading } from "../ui/SceneLoading";

// The smallest scene: a lit, spinning cube that renders every frame.
export default function HelloCube() {
  return (
    <Scene loading={<SceneLoading />} style={{ flex: 1 }} frameloop="always" debug>
      <Spin speed={1} axis={[0.5, 1, 0]}>
        <Box size={1.6} color="#ff9f59" />
      </Spin>
    </Scene>
  );
}
