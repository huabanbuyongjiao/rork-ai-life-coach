import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing, StyleSheet, View } from "react-native";

import { theme } from "@/constants/theme";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const ORB_SIZE = SCREEN_W * 1.55;

type Props = {
  intensity?: number;
};

/**
 * Spatial ambient background — three slow drifting accent glows + a breathing
 * field overlay on a deep graphite gradient. The interface should feel alive
 * but never decorative: closer to weather than to motion graphics.
 */
function AuroraBackgroundImpl({ intensity = 1 }: Props) {
  const drift1 = useRef(new Animated.Value(0)).current;
  const drift2 = useRef(new Animated.Value(0)).current;
  const drift3 = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v: Animated.Value, duration: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );
    const loops = [
      make(drift1, 24000),
      make(drift2, 31000),
      make(drift3, 38000),
      make(breath, 5200),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [drift1, drift2, drift3, breath]);

  const orb1TranslateX = drift1.interpolate({
    inputRange: [0, 1],
    outputRange: [-SCREEN_W * 0.22, SCREEN_W * 0.1],
  });
  const orb1TranslateY = drift1.interpolate({
    inputRange: [0, 1],
    outputRange: [-SCREEN_H * 0.06, SCREEN_H * 0.04],
  });
  const orb1Scale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.04],
  });

  const orb2TranslateX = drift2.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_W * 0.12, -SCREEN_W * 0.22],
  });
  const orb2TranslateY = drift2.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_H * 0.26, SCREEN_H * 0.36],
  });
  const orb2Scale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [1.03, 1],
  });

  const orb3TranslateX = drift3.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_W * 0.05, -SCREEN_W * 0.05],
  });
  const orb3TranslateY = drift3.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_H * 0.05, -SCREEN_H * 0.02],
  });

  const fieldOpacity = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 0.85],
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[theme.auroraTop, theme.auroraMid, theme.auroraBottom]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* Amber drift — warm, user-side */}
      <Animated.View
        style={[
          styles.orb,
          styles.orbAmber,
          {
            opacity: 0.16 * intensity,
            transform: [
              { translateX: orb1TranslateX },
              { translateY: orb1TranslateY },
              { scale: orb1Scale },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={[theme.amber + "55", "transparent"]}
          style={styles.orbInner}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 1, y: 1 }}
        />
      </Animated.View>
      {/* AI drift — cool, system-side */}
      <Animated.View
        style={[
          styles.orb,
          styles.orbAi,
          {
            opacity: 0.13 * intensity,
            transform: [
              { translateX: orb2TranslateX },
              { translateY: orb2TranslateY },
              { scale: orb2Scale },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={[theme.ai + "55", "transparent"]}
          style={styles.orbInner}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 1, y: 1 }}
        />
      </Animated.View>
      {/* Mid lavender breath — barely there, adds depth */}
      <Animated.View
        style={[
          styles.orb,
          styles.orbMid,
          {
            opacity: 0.06 * intensity,
            transform: [
              { translateX: orb3TranslateX },
              { translateY: orb3TranslateY },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={[theme.lavender + "44", "transparent"]}
          style={styles.orbInner}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 1, y: 1 }}
        />
      </Animated.View>
      {/* Subtle dark field that breathes — gives a sense of presence */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: fieldOpacity }]}
      >
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.35)"]}
          style={StyleSheet.absoluteFill}
          locations={[0.5, 1]}
        />
      </Animated.View>
      {/* Bottom vignette to ground content */}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.55)"]}
        style={StyleSheet.absoluteFill}
        locations={[0.6, 1]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  orb: {
    position: "absolute",
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
  },
  orbInner: {
    flex: 1,
    borderRadius: ORB_SIZE / 2,
  },
  orbAmber: {
    top: -ORB_SIZE * 0.52,
    left: -ORB_SIZE * 0.3,
  },
  orbAi: {
    bottom: -ORB_SIZE * 0.46,
    right: -ORB_SIZE * 0.32,
  },
  orbMid: {
    top: SCREEN_H * 0.18,
    left: -ORB_SIZE * 0.35,
  },
});

export default React.memo(AuroraBackgroundImpl);
