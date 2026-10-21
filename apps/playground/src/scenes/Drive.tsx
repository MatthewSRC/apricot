import { ContactShadow, Ground, Trees } from "@apricotjs/assets";
import { FollowCamera, Scene, type SceneObject, Vehicle } from "@apricotjs/react-native";
import { Model } from "@apricotjs/react-native/model";
import { useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Joystick, useJoystickValues } from "../../../../recipes/drive-joystick/Joystick";
import { SceneLoading } from "../ui/SceneLoading";

const CAR = require("../../assets/models/car.glb");

// A toy car driven with a joystick and followed by the camera. The car is a .glb built by `pnpm make-car`.
export default function Drive() {
  const car = useRef<SceneObject>(null);
  const { throttle, steer } = useJoystickValues();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <Scene
        loading={<SceneLoading />}
        style={{ flex: 1 }}
        look="soft"
        fog
        camera={{ position: [0, 2.6, -6], fov: 55 }}
        debug
      >
        <Ground />
        <Trees count={140} seed={3} />
        <Vehicle ref={car} throttle={throttle} steer={steer} bounds={[-90, -90, 90, 90]}>
          <Model src={CAR} />
          <ContactShadow width={1.5} length={2.5} opacity={0.4} />
        </Vehicle>
        <FollowCamera target={car} />
      </Scene>
      <Text style={[styles.hint, { bottom: 196 + insets.bottom }]}>
        Drag the stick: up to drive, sideways to steer
      </Text>
      <Joystick throttle={throttle} steer={steer} style={{ ...styles.stick, bottom: 32 + insets.bottom }} />
    </View>
  );
}

const styles = StyleSheet.create({
  stick: { position: "absolute", alignSelf: "center" },
  hint: { position: "absolute", alignSelf: "center", color: "#3d4a3a", fontSize: 13, fontWeight: "600" },
});
