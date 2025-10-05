// In-memory stream manager for SSE
export class StreamManager {
  private streams: Record<string, { writer: WritableStreamDefaultWriter, userId: string }> = {};

  add(writer: WritableStreamDefaultWriter, userId: string) {
    const streamId = `user-${userId}-${crypto.randomUUID()}`;
    this.streams[streamId] = { writer, userId };
    return streamId;
  }

  remove(streamId: string) {
    if (this.streams[streamId]) {
      delete this.streams[streamId];
    }
  }

  broadcast(userId: string, event: string, data: any | any[]) {
    // If data is an array, send each item as a separate event.
    const messages = Array.isArray(data) ? data : [data];
    const encoder = new TextEncoder();

    for (const item of messages) {
      const message = `event: ${event}\ndata: ${JSON.stringify(item)}\n\n`;
      const encodedMessage = encoder.encode(message);

      Object.entries(this.streams).forEach(([streamId, { writer, userId: streamUserId }]) => {
        if (streamUserId === userId) {
          writer.write(encodedMessage).catch(e => {
            console.error(`Failed to write to stream ${streamId}, it might be closed. Removing.`, e);
            writer.close().catch(() => {}); // Suppress errors on close
            this.remove(streamId);
          });
        }
      });
    }
  }
}

export const streamManager = new StreamManager();