export function syntheticAssistantOpaqueFields(summary = []) {
  // Synthetic schema sentinels; no captured provider ciphertext or reasoning.
  return {
    reasoningOpaque: "fixture-opaque-id",
    encryptedContent: "fixture-encrypted-payload",
    reasoningBlocks: { provider: "openai-responses", blocks: [{
      content: [], encrypted_content: "fixture-encrypted-payload",
      id: "fixture-opaque-id", summary: structuredClone(summary), type: "reasoning",
    }] },
  };
}
