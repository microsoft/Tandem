import { randomUUID } from "node:crypto";
import { BoardError, isRecord } from "./scene.mjs";
import { createBoard } from "./store.mjs";

export const DEFAULT_TOPIC_ID = "default";
export function createTopics() {
  const topics = new Map([[DEFAULT_TOPIC_ID, { topicId: DEFAULT_TOPIC_ID, name: "Main", board: createBoard() }]]);
  return {
    list() { return { defaultTopicId: DEFAULT_TOPIC_ID, topics: [...topics.values()].map(({ topicId, name }) => ({ topicId, name })) }; },
    get(topicId = DEFAULT_TOPIC_ID) {
      if (typeof topicId !== "string" || !topicId) throw new BoardError(400, "A nonempty topicId is required.");
      const topic = topics.get(topicId);
      if (!topic) throw new BoardError(404, "Topic is unavailable; no default topic was substituted.");
      return topic;
    },
    create(input) {
      if (!isRecord(input) || Object.keys(input).some((key) => key !== "name") ||
          typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80) {
        throw new BoardError(400, "Create a topic with a nonempty name of at most 80 characters.");
      }
      const topic = { topicId: `topic-${randomUUID()}`, name: input.name.trim(), board: createBoard() };
      topics.set(topic.topicId, topic);
      return { topicId: topic.topicId, name: topic.name };
    },
    state(topicId = DEFAULT_TOPIC_ID) {
      const topic = this.get(topicId);
      return { topicId: topic.topicId, topicName: topic.name, ...topic.board.state() };
    },
  };
}
