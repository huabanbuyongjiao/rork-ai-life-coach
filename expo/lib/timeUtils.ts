export function getGreeting(date: Date = new Date()): {
  text: string;
  tone: string;
} {
  const h = date.getHours();
  if (h >= 5 && h < 11)
    return { text: "早上好", tone: "新的一天，从一杯水和一次深呼吸开始。" };
  if (h >= 11 && h < 14)
    return { text: "中午好", tone: "记得吃午饭，给眼睛一点休息。" };
  if (h >= 14 && h < 18)
    return { text: "下午好", tone: "保持节奏，别忘了起身活动一下。" };
  if (h >= 18 && h < 22)
    return { text: "晚上好", tone: "今天表现得怎么样？" };
  if (h >= 22 || h < 1)
    return { text: "夜深了", tone: "差不多该准备休息了，明天会更清晰。" };
  return { text: "凌晨好", tone: "现在最重要的事是睡觉。" };
}

export function suggestedSleepText(date: Date = new Date()): string | null {
  const h = date.getHours();
  if (h >= 22 || h < 1) return "建议在 23:30 前入睡，能让大脑更高效。";
  if (h >= 1 && h < 5) return "请尽快休息，身体在这个时段最需要恢复。";
  return null;
}
