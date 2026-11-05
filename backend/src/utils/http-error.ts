// An expected failure whose code and message are safe to send to the client.
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}
