import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { theme } from "@/constants/theme";

function Dot({ delay }: { delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, {
          toValue: 1,
          duration: 880,
          delay,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(v, {
          toValue: 0,
          duration: 880,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, delay]);
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.92] });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] });
  return <Animated.View style={[styles.dot, { opacity, transform: [{ scale }] }]} />;
}

/**
 * Calm "thinking" indicator — three breathing dots in AI sky tint.
 * Micro scale + opacity, like ambient intelligence at work.
 */
export default function ThinkingDots() {
  return (
    <View style={styles.row}>
      <Dot delay={0} />
      <Dot delay={220} />
      <Dot delay={440} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.ai,
    shadowColor: theme.ai,
    shadowOpacity: 0.6,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
});
