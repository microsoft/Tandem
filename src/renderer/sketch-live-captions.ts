const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });

export function appendSketchLiveCaption(caption: string, delta: string): string {
  // VisionLoop forces full-stop boundaries when streamed sentences start in lowercase.
  const text = (caption + delta).replace(/(\.[\p{Close_Punctuation}\p{Final_Punctuation}"']*)\s+(?=\S)/gu, "$1\n");
  let start = 0;
  for (const { segment, index } of sentenceSegmenter.segment(text)) {
    if (segment.trim()) start = index;
  }
  // Keep trailing whitespace: the next delta may start a new sentence.
  return text.slice(start);
}
