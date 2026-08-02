import { describe, it, expect } from 'vitest'
import { computeNoteBuckets, computePeakMidis } from './spectrum-bars.js'
import { frequencyFromMidi } from './notes.js'

const SAMPLE_RATE = 44100
const FFT_SIZE = 8192
const BIN_HZ = SAMPLE_RATE / FFT_SIZE

describe('computeNoteBuckets', () => {
  it('attributes a single loud bin to its nearest note, leaving neighbors at 0', () => {
    const freqData = new Uint8Array(4096)
    const binIndexNear440 = Math.round(440 / BIN_HZ)
    freqData[binIndexNear440] = 200

    const buckets = computeNoteBuckets(freqData, BIN_HZ, 27.5, 4186)
    const a4 = buckets.find((b) => b.midi === 69)
    const gSharp4 = buckets.find((b) => b.midi === 68)
    const aSharp4 = buckets.find((b) => b.midi === 70)

    expect(a4.value).toBe(200)
    expect(gSharp4.value).toBe(0)
    expect(aSharp4.value).toBe(0)
  })

  it('computes bucket boundaries from frequencyFromMidi(midi +/- 0.5)', () => {
    const freqData = new Uint8Array(4096)
    const buckets = computeNoteBuckets(freqData, BIN_HZ, 27.5, 4186)
    const a4 = buckets.find((b) => b.midi === 69)

    expect(a4.lowFreq).toBeCloseTo(frequencyFromMidi(68.5), 5)
    expect(a4.highFreq).toBeCloseTo(frequencyFromMidi(69.5), 5)
  })

  it('takes the max across multiple bins in one bucket, not sum or average', () => {
    const freqData = new Uint8Array(4096)
    const lowC5 = frequencyFromMidi(71.5)
    const highC5 = frequencyFromMidi(72.5)
    const startBin = Math.ceil(lowC5 / BIN_HZ)
    freqData[startBin] = 50
    freqData[startBin + 1] = 180
    freqData[Math.floor(highC5 / BIN_HZ)] = 90

    const buckets = computeNoteBuckets(freqData, BIN_HZ, 27.5, 4186)
    expect(buckets.find((b) => b.midi === 72).value).toBe(180)
  })

  it('only returns buckets overlapping the given frequency range', () => {
    const freqData = new Uint8Array(4096)
    const buckets = computeNoteBuckets(freqData, BIN_HZ, 440, 440)
    const midis = buckets.map((b) => b.midi)

    expect(Math.min(...midis)).toBe(Math.floor(69 - 0.5))
    expect(Math.max(...midis)).toBe(Math.ceil(69 + 0.5))
  })

  it('returns buckets ordered by ascending midi', () => {
    const freqData = new Uint8Array(4096)
    const buckets = computeNoteBuckets(freqData, BIN_HZ, 220, 880)
    const midis = buckets.map((b) => b.midi)
    const sorted = [...midis].sort((a, b) => a - b)
    expect(midis).toEqual(sorted)
  })
})

function bucket(midi, value) {
  return { midi, lowFreq: 0, highFreq: 0, value }
}

describe('computePeakMidis', () => {
  // The second argument is a MARGIN a bucket must clear above this frame's
  // own average bucket value - not an absolute floor - so a "peak" is only
  // real relative to how much is actually going on in that frame. This is
  // what makes an isolated loud bucket in an otherwise-quiet frame register,
  // while a bucket that's merely locally-highest in an uninteresting flat
  // region (common at low frequencies, where coarse FFT resolution means
  // several adjacent semitone buckets read nearly the same value) does not.

  it('detects an isolated loud bucket as a peak', () => {
    const buckets = [bucket(60, 10), bucket(61, 10), bucket(62, 80), bucket(63, 10), bucket(64, 10)]
    // average = 24; margin 30 -> needs >= 54
    expect(computePeakMidis(buckets, 30)).toEqual([62])
  })

  it('does not detect a locally-highest bucket that is not meaningfully above the frame average', () => {
    const buckets = [bucket(60, 20), bucket(61, 22), bucket(62, 21)]
    // average = 21; margin 30 -> needs >= 51, nothing gets close
    expect(computePeakMidis(buckets, 30)).toEqual([])
  })

  it('does not detect a bucket that is lower than a neighbor', () => {
    const buckets = [bucket(60, 10), bucket(61, 50), bucket(62, 80)]
    // average = 46.67; margin 20 -> needs >= 66.67, only 80 qualifies
    expect(computePeakMidis(buckets, 20)).toEqual([62])
  })

  it('does not flag the first bucket just because it has no prev to compare against - it still needs the margin', () => {
    // Before this fix, the first bucket only had to beat "next" (no "prev"
    // exists to fail against), so a merely-declining run like this would
    // wrongly flag bucket 60 as a peak. It should not, once "peak" also
    // means "clearly above this frame's average," not just "edge of array."
    const buckets = [bucket(60, 30), bucket(61, 25), bucket(62, 20)]
    // average = 25; margin 10 -> needs >= 35, and 30 doesn't reach it
    expect(computePeakMidis(buckets, 10)).toEqual([])
  })

  it('still flags the first bucket when it genuinely is a strong peak', () => {
    const buckets = [bucket(60, 90), bucket(61, 20), bucket(62, 10)]
    // average = 40; margin 30 -> needs >= 70, 90 qualifies
    expect(computePeakMidis(buckets, 30)).toEqual([60])
  })

  it('counts a plateau of equal-value adjacent buckets as multiple peaks, when the plateau itself clears the margin', () => {
    const buckets = [bucket(60, 10), bucket(61, 60), bucket(62, 60), bucket(63, 10)]
    // average = 35; margin 20 -> needs >= 55, both 60s qualify
    expect(computePeakMidis(buckets, 20)).toEqual([61, 62])
  })

  it('suppresses a flat, alternating low-information region entirely (the reported bug)', () => {
    // A realistic low-frequency scenario: coarse FFT resolution makes
    // adjacent semitone buckets read almost the same (noisy/insignificant)
    // value, alternating slightly due to rounding. The old local-max-only
    // check would flag every other bucket as a "peak" purely from this
    // alternation, even though none of them are musically significant.
    const buckets = [
      bucket(36, 20),
      bucket(37, 19),
      bucket(38, 20),
      bucket(39, 19),
      bucket(40, 20),
      bucket(41, 19),
      bucket(42, 20),
    ]
    // average ~= 19.57; margin 5 -> needs >= 24.57, nothing reaches it
    expect(computePeakMidis(buckets, 5)).toEqual([])
  })

  it('returns no peaks for an empty buckets array', () => {
    expect(computePeakMidis([], 30)).toEqual([])
  })
})
