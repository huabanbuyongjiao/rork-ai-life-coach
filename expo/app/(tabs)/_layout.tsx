import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { CalendarRange, CircleDot, User } from "lucide-react-native";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

import { theme } from "@/constants/theme";

export default function TabLayout() {
  return (
    <Tabs
      initialRouteName="today"
      screenOptions={{
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textFaint,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor:
            Platform.OS === "android" ? "rgba(8,9,12,0.94)" : "transparent",
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.borderFaint,
          elevation: 0,
          height: Platform.select({ ios: 84, android: 66, default: 66 }),
          paddingTop: 8,
        },
        tabBarBackground:
          Platform.OS === "android"
            ? undefined
            : () => (
                <View style={StyleSheet.absoluteFill}>
                  <BlurView
                    tint="dark"
                    intensity={70}
                    style={StyleSheet.absoluteFill}
                  />
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: "rgba(8,9,12,0.48)" },
                    ]}
                  />
                </View>
              ),
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0,
          textTransform: "uppercase",
          marginTop: 2,
        },
        tabBarItemStyle: {
          paddingTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Capture",
          tabBarIcon: ({ color, size }) => (
            <CircleDot color={color} size={size ?? 20} strokeWidth={1.6} />
          ),
        }}
      />
      <Tabs.Screen
        name="today"
        options={{
          title: "Today",
          tabBarIcon: ({ color, size }) => (
            <CalendarRange color={color} size={size ?? 20} strokeWidth={1.6} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "You",
          tabBarIcon: ({ color, size }) => (
            <User color={color} size={size ?? 19} strokeWidth={1.6} />
          ),
        }}
      />
      <Tabs.Screen name="goals" options={{ href: null }} />
      <Tabs.Screen name="agents" options={{ href: null }} />
      <Tabs.Screen name="memory" options={{ href: null }} />
    </Tabs>
  );
}
