import { Pressable, StyleSheet, Text } from "react-native";

export interface ChipColors {
  background: string;
  text: string;
  strong: string;
}

interface ChipProps {
  label: string;
  onPress: () => void;
  colors: ChipColors;
  /** Filled with the strong colour, as for the chosen option. */
  strong?: boolean;
  disabled?: boolean;
}

/** A rounded button for a scene's control panel. */
export function Chip({ label, onPress, colors, strong, disabled }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        { backgroundColor: strong ? colors.strong : colors.background },
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, { color: strong ? "#ffffff" : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999 },
  label: { fontSize: 14, fontWeight: "600" },
  disabled: { opacity: 0.4 },
});
