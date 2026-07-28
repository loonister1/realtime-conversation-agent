import { vi } from "vitest";

export class MockMessagePort {
  postMessage = vi.fn();
  close = vi.fn();
  onmessage: ((event: { data: Record<string, unknown> }) => void) | null = null;
}

export class MockAudioWorkletNode {
  static instances: MockAudioWorkletNode[] = [];

  port = new MockMessagePort();
  connect = vi.fn();
  disconnect = vi.fn();
  processorName: string;

  constructor(_context: MockAudioContext, processorName: string) {
    this.processorName = processorName;
    MockAudioWorkletNode.instances.push(this);
  }

  static withName(processorName: string): MockAudioWorkletNode | undefined {
    return MockAudioWorkletNode.instances.find(
      (node) => node.processorName === processorName
    );
  }
}

export class MockAudioContext {
  static instances: MockAudioContext[] = [];

  state: "running" | "suspended" | "closed" = "running";
  destination = {};
  sampleRate: number;
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  audioWorklet = { addModule: vi.fn(async () => undefined) };

  constructor(options: { sampleRate: number }) {
    this.sampleRate = options.sampleRate;
    MockAudioContext.instances.push(this);
  }
}

export class MockMediaStreamTrack {
  stop = vi.fn();

  constructor(public kind: "audio" | "video") {}
}

export class MockMediaStream {
  tracks: MockMediaStreamTrack[];

  constructor(tracks: MockMediaStreamTrack[] = []) {
    this.tracks = tracks;
  }

  getTracks() {
    return this.tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
}

type WebSocketHandler<E> = ((event: E) => void) | null;

export class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readyState: number = MockWebSocket.CONNECTING;
  sent: string[] = [];

  onopen: WebSocketHandler<Event> = null;
  onmessage: WebSocketHandler<{ data: string }> = null;
  onclose: WebSocketHandler<{ code?: number }> = null;
  onerror: WebSocketHandler<Event> = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  /** Test helper: simulate the server accepting the connection. */
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  /** Test helper: simulate a structured agent event arriving from the server. */
  simulateMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** Everything the hook has sent, parsed back out of JSON. */
  sentMessages(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw));
  }

  static last(): MockWebSocket {
    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error("No WebSocket was created");
    return socket;
  }
}

export function createVideoElement(
  overrides: Partial<{
    readyState: number;
    videoWidth: number;
    videoHeight: number;
  }> = {}
): HTMLVideoElement {
  return {
    HAVE_METADATA: 1,
    readyState: 1,
    videoWidth: 640,
    videoHeight: 480,
    srcObject: null,
    play: vi.fn(),
    ...overrides,
  } as unknown as HTMLVideoElement;
}

export function createCanvasElement(
  dataUrl = "data:image/jpeg;base64,ZnJhbWU="
): HTMLCanvasElement {
  const context = { drawImage: vi.fn() };
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => dataUrl),
  } as unknown as HTMLCanvasElement;
}

export function resetMocks() {
  MockWebSocket.instances = [];
  MockAudioContext.instances = [];
  MockAudioWorkletNode.instances = [];
}
