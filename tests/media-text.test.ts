import { describe, it, expect } from 'vitest';
import { containsMediaPromise, neutralizeMediaPromise } from '../src/media/media-text.js';

describe('media promise guard', () => {
  it('keeps a normal reply untouched', () => {
    expect(neutralizeMediaPromise('coucou, ça va ?')).toBe('coucou, ça va ?');
    expect(containsMediaPromise('tu me manques 😘')).toBe(false);
  });

  it('detects French delivery promises', () => {
    expect(containsMediaPromise("je t'envoie la vidéo 😉")).toBe(true);
    expect(containsMediaPromise("je t'envoie des photos")).toBe(true);
    expect(containsMediaPromise('voici ma vidéo')).toBe(true);
    expect(containsMediaPromise('je viens de t\'envoyer ça')).toBe(true);
  });

  it('detects English delivery promises', () => {
    expect(containsMediaPromise('here it is 😉')).toBe(true);
    expect(containsMediaPromise("i'll send the video now")).toBe(true);
    expect(containsMediaPromise('just sent it')).toBe(true);
  });

  it('replaces a promise-carrying message with a natural non-lie', () => {
    const result = neutralizeMediaPromise("je t'envoie la vidéo 😉");
    expect(result).not.toBe("je t'envoie la vidéo 😉");
    expect(containsMediaPromise(result)).toBe(false);
    expect(result.length).toBeGreaterThan(0);
  });
});