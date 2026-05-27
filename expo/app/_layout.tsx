import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuroraProvider } from "@/providers/AuroraProvider";
import { GmailProvider } from "@/providers/GmailProvider";
import { theme } from "@/constants/theme";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
    mutations: { retry: 0 },
  },
});

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerBackTitle: "Back",
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="modal"
        options={{
          presentation: "modal",
          headerShown: false,
          contentStyle: { backgroundColor: "transparent" },
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuroraProvider>
        <GmailProvider>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
            <StatusBar style="light" />
            <RootLayoutNav />
          </GestureHandlerRootView>
        </GmailProvider>
      </AuroraProvider>
    </QueryClientProvider>
  );
}
