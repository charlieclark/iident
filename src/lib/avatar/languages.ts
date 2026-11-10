/** Persona languages and their ISO 639-1 codes, for speech-to-text. */
export const LANGUAGE_CODES: Record<string, string> = {
  English: "en",
  Spanish: "es",
  French: "fr",
  German: "de",
  Portuguese: "pt",
  Italian: "it",
  Japanese: "ja",
  Korean: "ko",
  Chinese: "zh",
  Hindi: "hi",
};

export const languageCode = (language: string | undefined) => (language ? LANGUAGE_CODES[language] : undefined);
