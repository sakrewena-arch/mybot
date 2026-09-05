/**
 * Guards against the AI "promising" a paid media (photo/video) in its reply
 * text but never actually sending it (cooldown, hallucinated media id, API
 * failure…). When the media was NOT sent, any strong "here it is / I'll send"
 * phrasing is replaced with a natural, subtle line so Esther never blatantly
 * lies ("je t'envoie la vidéo" → nothing sent).
 */

const MEDIA_PROMISE_STRONG = [
  /\bje\s*t['’]?envoie\b/i,
  /\bje\s*t['’]?envois\b/i,
  /\bje\s*t['’]?envoye\b/i,
  /\bje\s*viens\s*de\s*t['’]?envoyer\b/i,
  /\bje\s*t['’]?ai\s*envoy[ée]\b/i,
  /\bje\s*t'e[’']?l['’]?envoie\b/i,
  /\bvoici\b/i,
  /\bet\s*voil[àa]\b/i,
  /\bça\s*arrive\b|\bca\s*arrive\b/i,
  /\bi['’]?ll\s*send\b|\bill\s*send\b/i,
  /\bhere you go\b|\bhere it is\b|\bhere'?s (?:your|the)\b/i,
  /\bi sent\b|\bjust sent\b|\bsent it\b|\bon its way\b|\bcoming (?:right )?up\b/i,
];

/** Replacements used when a promise is found but nothing was sent. */
const PROMISE_FALLBACKS = [
  "hmm je crois que ça n'est pas parti de mon côté 😅 je te redis ça dans une seconde !",
  "ahh mon téléphone vient de buguer une seconde 😅 je renvoie dans un instant !",
  "oups ça a lagué 😅 one sec, je renvoie !",
];

export function containsMediaPromise(text: string): boolean {
  return MEDIA_PROMISE_STRONG.some((re) => re.test(text));
}

/**
 * Returns the same text, unless it strongly promises a photo/video delivery —
 * in which case the whole message is replaced by a natural fallback (the text
 * was written assuming the media would be sent, so it cannot be trusted).
 */
export function neutralizeMediaPromise(text: string): string {
  if (!containsMediaPromise(text)) return text;
  return PROMISE_FALLBACKS[Math.floor(Math.random() * PROMISE_FALLBACKS.length)]!;
}