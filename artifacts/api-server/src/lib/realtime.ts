import { EventEmitter } from "node:events";

type RealtimeEvent = {
  type: "message" | "notification" | "heartbeat";
  patientId?: number;
  id?: number;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function subscribeUser(userId: number, listener: (event: RealtimeEvent) => void): () => void {
  const channel = `user:${userId}`;
  emitter.on(channel, listener);
  return () => emitter.off(channel, listener);
}

export function publishUser(userId: number, event: RealtimeEvent): void {
  emitter.emit(`user:${userId}`, event);
}

export function publishUsers(userIds: Array<number | undefined>, event: RealtimeEvent): void {
  [...new Set(userIds.filter((id): id is number => typeof id === "number"))].forEach((id) => publishUser(id, event));
}
