import { theme } from "./theme";

const tintColorLight = theme.amber;

export default {
  light: {
    text: theme.text,
    background: theme.bg,
    tint: tintColorLight,
    tabIconDefault: theme.textDim,
    tabIconSelected: tintColorLight,
  },
};
