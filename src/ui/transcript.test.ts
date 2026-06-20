import { describe, expect, it } from 'vitest';
import { getTranscriptWindow, transcriptScrollStep, transcriptWindowSize } from './transcript.js';

describe('transcript windowing', () => {
  it('pins to the latest turns by default', () => {
    expect(getTranscriptWindow(50, 10, 0)).toEqual({
      end: 50,
      scrollFromBottom: 0,
      showNewer: false,
      showOlder: true,
      start: 40,
    });
  });

  it('scrolls upward while keeping a fixed window size', () => {
    expect(getTranscriptWindow(50, 10, 5)).toEqual({
      end: 45,
      scrollFromBottom: 5,
      showNewer: true,
      showOlder: true,
      start: 35,
    });
  });

  it('clamps scroll when the history is shorter than the window', () => {
    expect(getTranscriptWindow(4, 10, 99)).toEqual({
      end: 4,
      scrollFromBottom: 0,
      showNewer: false,
      showOlder: false,
      start: 0,
    });
  });

  it('derives window size from terminal rows', () => {
    expect(transcriptWindowSize(24)).toBe(12);
    expect(transcriptWindowSize(undefined)).toBe(12);
    expect(transcriptWindowSize(80)).toBe(40);
  });

  it('uses a sensible scroll step', () => {
    expect(transcriptScrollStep(10)).toBe(5);
    expect(transcriptScrollStep(7)).toBe(3);
  });
});
