import { BlurView } from "expo-blur";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  ViewProps,
  ViewStyle,
} from "react-native";

import { theme } from "@/constants/theme";

type Variant = "soft" | "elevated" | "flat" | "inset" | "ai" | "focus";

type Props = ViewProps & {
  intensity?: number;
  radius?: number;
  bordered?: boolean;
  /**
   * - "soft" (default): barely-there floating panel
   * - "elevated": slightly more presence, hero cards
   * - "flat": no blur, used inside other glass surfaces
   * - "inset": sunken, for chat composer / inputs
   * - "ai": AI surface — soft sky glow, very subtle pulse
   * - "focus": today's focus — soft amber glow, breathing
   */
  variant?: Variant;
  /** If true, ambient glow gently breathes (used for ai / focus) */
  alive?: boolean;
  style?: ViewStyle | ViewStyle[];
};

/**
 * Spatial glass surface. Hairline border, near-invisible tint, optional blur
 * on iOS. Variants "ai" and "focus" add a soft outer glow that breathes,
 * giving the AI/active surfaces presence without being decorative.
 */
function GlassCardImpl({
  children,
  intensity = 22,
  radius = 18,
  bordered = true,
  variant = "soft",
  alive,
  style,
  ...rest
}: Props) {
  const pulse = useRef(new Animated.Value(0)).current;
  const shouldBreathe =
    alive ?? (variant === "ai" || variant === "focus");

  useEffect(() => {
    if (!shouldBreathe) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 3800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 3800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, shouldBreathe]);

  const tint =
    variant === "elevated"
      ? theme.surfaceStrong
      : variant === "flat"
        ? theme.surfaceSoft
        : variant === "inset"
          ? "rgba(0,0,0,0.18)"
          : variant === "ai"
            ? "rgba(134,181,226,0.035)"
            : variant === "focus"
              ? "rgba(229,165,96,0.035)"
              : theme.surface;

  const borderColor =
    variant === "elevated"
      ? theme.borderStrong
      : variant === "inset"
        ? theme.borderFaint
        : variant === "ai"
          ? theme.aiStroke
          : variant === "focus"
            ? theme.amberStroke
            : theme.border;

  const androidBg =
    variant === "elevated"
      ? "rgba(18,19,23,0.94)"
      : variant === "inset"
        ? "rgba(10,11,14,0.96)"
        : variant === "ai"
          ? "rgba(16,20,28,0.92)"
          : variant === "focus"
            ? "rgba(24,18,12,0.92)"
            : "rgba(14,15,19,0.90)";

  // Ambient shadow glow for ai/focus — outer presence
  const glowColor =
    variant === "ai"
      ? theme.ai
      : variant === "focus"
        ? theme.amber
        : "transparent";
  const shadowOpacity = shouldBreathe
    ? pulse.interpolate({
        inputRange: [0, 1],
        outputRange: variant === "ai" ? [0.18, 0.32] : [0.16, 0.28],
      })
    : 0;

  const containerStyle: ViewStyle = {
    borderRadius: radius,
    overflow: "hidden",
    borderWidth: bordered ? StyleSheet.hairlineWidth : 0,
    borderColor,
    backgroundColor: Platform.OS === "android" ? androidBg : "transparent",
  };

  const inner = (
    <View style={[containerStyle, style]} {...rest}>
      {Platform.OS !== "android" && variant !== "flat" && (
        <BlurView
          intensity={variant === "elevated" || variant === "ai" ? intensity + 8 : intensity}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
      )}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: tint }]}
      />
      {(variant === "elevated" || variant === "ai" || variant === "focus") && (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor:
                variant === "ai"
                  ? "rgba(134,181,226,0.18)"
                  : variant === "focus"
                    ? "rgba(229,165,96,0.16)"
                    : "rgba(255,255,255,0.08)",
            },
          ]}
        />
      )}
      {children}
    </View>
  );

  if (shouldBreathe && Platform.OS !== "android") {
    return (
      <Animated.View
        style={{
          borderRadius: radius,
          shadowColor: glowColor,
          shadowOpacity,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        {inner}
      </Animated.View>
    );
  }
  return inner;
}

export default React.memo(GlassCardImpl);
