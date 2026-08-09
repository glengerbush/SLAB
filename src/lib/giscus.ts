const supportedLanguages = new Set([
  "ar",
  "be",
  "bg",
  "ca",
  "cs",
  "da",
  "de",
  "en",
  "eo",
  "es",
  "eu",
  "fa",
  "fr",
  "gr",
  "hbs",
  "he",
  "hu",
  "id",
  "it",
  "ja",
  "kh",
  "ko",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "th",
  "tr",
  "uk",
  "uz",
  "vi",
  "zh-CN",
  "zh-HK",
  "zh-TW",
]);

export function giscusLanguage(locale: string) {
  let parsed: Intl.Locale;
  try {
    parsed = new Intl.Locale(locale);
  } catch {
    return "en";
  }
  if (parsed.language === "zh") {
    const region = parsed.region?.toUpperCase();
    if (region === "HK" || region === "MO") return "zh-HK";
    if (region === "TW" || parsed.script === "Hant") return "zh-TW";
    return "zh-CN";
  }
  const aliases: Record<string, string> = { el: "gr", km: "kh" };
  const language = aliases[parsed.language] ?? parsed.language;
  return supportedLanguages.has(language) ? language : "en";
}
