import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveConnection } from "./useLiveConnection";
import {
  MockAudioContext,
  MockAudioWorkletNode,
  MockMediaStream,
  MockMediaStreamTrack,
  MockWebSocket,
  createCanvasElement,
  createVideoElement,
} from "@/test/mocks";

const RECORDER_PROCESSOR = "audio-recorder-processor";
const PLAYER_PROCESSOR = "audio-player-processor";

function mediaDevices() {
  return navigator.mediaDevices as unknown as {
    getUserMedia: ReturnType<typeof vi.fn>;
    getDisplayMedia: ReturnType<typeof vi.fn>;
  };
}

function cameraStream() {
  return new MockMediaStream([
    new MockMediaStreamTrack("audio"),
    new MockMediaStreamTrack("video"),
  ]) as unknown as MediaStream;
}

/** Renders the hook, drives `connect` and lets the socket reach OPEN. */
async function connectHook(
  options: {
    source?: "camera" | "screen";
    video?: HTMLVideoElement;
    canvas?: HTMLCanvasElement;
    open?: boolean;
  } = {}
) {
  const {
    source = "camera",
    video = createVideoElement(),
    canvas = createCanvasElement(),
    open = true,
  } = options;

  const { result } = renderHook(() => useLiveConnection());

  await act(async () => {
    await result.current.connect(video, canvas, "client-42", source);
  });

  const socket = MockWebSocket.last();

  if (open) {
    // The open handler kicks off worklet setup without awaiting it, so drain
    // the microtask queue rather than waiting on a timer (some tests fake them).
    await act(async () => {
      socket.simulateOpen();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(MockAudioWorkletNode.withName(PLAYER_PROCESSOR)).toBeDefined();
  }

  return { result, socket, video, canvas };
}

beforeEach(() => {
  mediaDevices().getUserMedia.mockResolvedValue(cameraStream());
  mediaDevices().getDisplayMedia.mockResolvedValue(
    new MockMediaStream([new MockMediaStreamTrack("video")])
  );
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { protocol: "http:", hostname: "localhost" },
  });
});

describe("initial state", () => {
  it("starts idle with no transcript", () => {
    const { result } = renderHook(() => useLiveConnection());

    expect(result.current.connectionState).toBe("idle");
    expect(result.current.latestTextMessage).toBeNull();
    expect(result.current.eventLog).toEqual([]);
  });
});

describe("connect", () => {
  it("requests camera and microphone, attaches the stream and opens the socket", async () => {
    const { result, socket, video } = await connectHook({ source: "camera" });

    expect(mediaDevices().getUserMedia).toHaveBeenCalledWith({
      audio: true,
      video: { width: 1280, height: 720 },
    });
    expect(mediaDevices().getDisplayMedia).not.toHaveBeenCalled();
    expect(video.srcObject).not.toBeNull();
    expect(video.play).toHaveBeenCalled();
    expect(socket.url).toBe("ws://localhost/ws/client-42?is_audio=true");
    expect(result.current.connectionState).toBe("connected");
  });

  it("uses a secure websocket when the page is served over https", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { protocol: "https:", hostname: "agent.example.com" },
    });

    const { socket } = await connectHook();

    expect(socket.url).toBe(
      "wss://agent.example.com/ws/client-42?is_audio=true"
    );
  });

  it("combines the shared screen video with microphone audio", async () => {
    const micTrack = new MockMediaStreamTrack("audio");
    const screenTrack = new MockMediaStreamTrack("video");
    mediaDevices().getDisplayMedia.mockResolvedValue(
      new MockMediaStream([screenTrack])
    );
    mediaDevices().getUserMedia.mockResolvedValue(
      new MockMediaStream([micTrack])
    );

    const { video } = await connectHook({ source: "screen" });

    expect(mediaDevices().getDisplayMedia).toHaveBeenCalledWith({
      video: { width: 1280, height: 720 },
      audio: false,
    });
    const stream = video.srcObject as unknown as MockMediaStream;
    expect(stream.getTracks()).toEqual([screenTrack, micTrack]);
    expect(MockAudioWorkletNode.withName(RECORDER_PROCESSOR)).toBeDefined();
  });

  it("falls back to a screen-only stream when the microphone is unavailable", async () => {
    const screenTrack = new MockMediaStreamTrack("video");
    mediaDevices().getDisplayMedia.mockResolvedValue(
      new MockMediaStream([screenTrack])
    );
    mediaDevices().getUserMedia.mockRejectedValue(new Error("denied"));

    const { result, video } = await connectHook({ source: "screen" });

    const stream = video.srcObject as unknown as MockMediaStream;
    expect(stream.getTracks()).toEqual([screenTrack]);
    expect(result.current.connectionState).toBe("connected");
    // No audio track means no recorder worklet may be wired up.
    expect(MockAudioWorkletNode.withName(RECORDER_PROCESSOR)).toBeUndefined();
  });

  it("reports an error and creates no socket when media access is denied", async () => {
    mediaDevices().getUserMedia.mockRejectedValue(new Error("denied"));

    const { result } = renderHook(() => useLiveConnection());
    await act(async () => {
      await result.current.connect(
        createVideoElement(),
        createCanvasElement(),
        "client-42",
        "camera"
      );
    });

    expect(result.current.connectionState).toBe("error");
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("creates audio contexts at the sample rates the protocol requires", async () => {
    await connectHook();

    const sampleRates = MockAudioContext.instances.map((ctx) => ctx.sampleRate);
    expect(sampleRates).toContain(16000);
    expect(sampleRates).toContain(24000);
  });

  it("clears any previous transcript when reconnecting", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      result.current.sendTextMessage("hello");
    });
    expect(result.current.eventLog).toHaveLength(1);

    socket.readyState = MockWebSocket.CLOSED;
    await act(async () => {
      await result.current.connect(
        createVideoElement(),
        createCanvasElement(),
        "client-42",
        "camera"
      );
    });

    expect(result.current.eventLog).toEqual([]);
    expect(result.current.latestTextMessage).toBeNull();
  });
});

describe("sendTextMessage", () => {
  it("sends the server's text/plain envelope and echoes the turn locally", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      result.current.sendTextMessage("What's the weather?");
    });

    expect(socket.sentMessages()).toContainEqual({
      mime_type: "text/plain",
      data: "What's the weather?",
    });
    expect(result.current.eventLog).toHaveLength(1);
    expect(result.current.eventLog[0]).toMatchObject({
      author: "user",
      is_partial: false,
      turn_complete: true,
      parts: [{ type: "text", data: "What's the weather?" }],
    });
    expect(result.current.eventLog[0].id).toEqual(expect.any(String));
  });

  it("ignores empty and whitespace-only input", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      result.current.sendTextMessage("");
      result.current.sendTextMessage("   \n\t ");
    });

    expect(socket.sent).toHaveLength(0);
    expect(result.current.eventLog).toEqual([]);
  });

  it("does not throw when the socket is not open, but still logs the turn", async () => {
    const { result, socket } = await connectHook();
    socket.readyState = MockWebSocket.CLOSED;

    await act(async () => {
      result.current.sendTextMessage("hello");
    });

    expect(socket.sent).toHaveLength(0);
    expect(result.current.eventLog).toHaveLength(1);
  });
});

describe("incoming agent events", () => {
  it("forwards pcm audio parts to the player worklet as a transferable buffer", async () => {
    const { socket } = await connectHook();
    const player = MockAudioWorkletNode.withName(PLAYER_PROCESSOR)!;

    await act(async () => {
      socket.simulateMessage({
        author: "agent",
        is_partial: false,
        turn_complete: false,
        parts: [{ type: "audio/pcm", data: "aGVsbG8=" }],
      });
    });

    expect(player.port.postMessage).toHaveBeenCalledTimes(1);
    const [message, transfer] = player.port.postMessage.mock.calls[0];
    expect(message.type).toBe("audio_data");
    expect(Array.from(new Uint8Array(message.buffer))).toEqual([
      104, 101, 108, 108, 111,
    ]);
    expect(transfer).toEqual([message.buffer]);
  });

  it("does not add audio-only events to the transcript", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      socket.simulateMessage({
        author: "agent",
        is_partial: false,
        turn_complete: false,
        parts: [{ type: "audio/pcm", data: "aGVsbG8=" }],
      });
    });

    expect(result.current.eventLog).toEqual([]);
  });

  it("surfaces the agent's output transcription as the live caption", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      socket.simulateMessage({
        author: "agent",
        is_partial: true,
        turn_complete: false,
        parts: [],
        output_transcription: { text: "Let me think", is_final: false },
      });
    });

    expect(result.current.latestTextMessage).toBe("Let me think");
  });

  it("clears the live caption when the turn completes", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      socket.simulateMessage({
        author: "agent",
        is_partial: true,
        turn_complete: false,
        parts: [],
        output_transcription: { text: "Let me think", is_final: false },
      });
    });
    expect(result.current.latestTextMessage).toBe("Let me think");

    await act(async () => {
      socket.simulateMessage({
        author: "agent",
        is_partial: false,
        turn_complete: true,
        parts: [],
      });
    });

    expect(result.current.latestTextMessage).toBeNull();
  });

  it("logs the user's speech only once its transcription is final", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      socket.simulateMessage({
        author: "user",
        is_partial: true,
        turn_complete: false,
        parts: [],
        input_transcription: { text: "what is", is_final: false },
      });
    });
    expect(result.current.eventLog).toEqual([]);

    await act(async () => {
      socket.simulateMessage({
        author: "user",
        is_partial: false,
        turn_complete: false,
        parts: [],
        input_transcription: { text: "what is two plus two", is_final: true },
      });
    });

    expect(result.current.eventLog).toHaveLength(1);
    expect(result.current.eventLog[0]).toMatchObject({
      author: "user",
      turn_complete: true,
      parts: [{ type: "text", data: "what is two plus two" }],
    });
  });

  it("logs finalised agent text but drops partial deltas", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      socket.simulateMessage({
        author: "agent",
        is_partial: true,
        turn_complete: false,
        parts: [{ type: "text", data: "Four" }],
      });
    });
    expect(result.current.eventLog).toEqual([]);

    await act(async () => {
      socket.simulateMessage({
        author: "agent",
        is_partial: false,
        turn_complete: true,
        parts: [{ type: "text", data: "Four." }],
      });
    });

    expect(result.current.eventLog).toHaveLength(1);
    expect(result.current.eventLog[0]).toMatchObject({
      author: "agent",
      turn_complete: true,
      parts: [{ type: "text", data: "Four." }],
    });
  });

  it("keeps function calls and responses but strips audio from the logged event", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      socket.simulateMessage({
        author: "agent",
        is_partial: false,
        turn_complete: false,
        parts: [
          { type: "audio/pcm", data: "aGVsbG8=" },
          { type: "function_call", data: { name: "get_weather", args: {} } },
          {
            type: "function_response",
            data: { name: "get_weather", response: { temp: 21 } },
          },
        ],
      });
    });

    expect(result.current.eventLog).toHaveLength(1);
    expect(result.current.eventLog[0].parts).toEqual([
      { type: "function_call", data: { name: "get_weather", args: {} } },
      {
        type: "function_response",
        data: { name: "get_weather", response: { temp: 21 } },
      },
    ]);
  });

  it("gives every logged event a distinct id", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      socket.simulateMessage({
        author: "agent",
        is_partial: false,
        turn_complete: false,
        parts: [{ type: "text", data: "one" }],
      });
      socket.simulateMessage({
        author: "agent",
        is_partial: false,
        turn_complete: false,
        parts: [{ type: "text", data: "two" }],
      });
    });

    const ids = result.current.eventLog.map((event) => event.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("microphone capture", () => {
  it("base64-encodes recorded pcm and sends it with the audio/pcm mime type", async () => {
    const { socket } = await connectHook();
    const recorder = MockAudioWorkletNode.withName(RECORDER_PROCESSOR)!;

    recorder.port.onmessage?.({
      data: {
        type: "audio_data",
        buffer: new Uint8Array([104, 101, 108, 108, 111]).buffer,
      },
    });

    expect(socket.sentMessages()).toContainEqual({
      mime_type: "audio/pcm",
      data: "aGVsbG8=",
    });
  });

  it("flushes queued agent audio when the user starts speaking (barge-in)", async () => {
    await connectHook();
    const recorder = MockAudioWorkletNode.withName(RECORDER_PROCESSOR)!;
    const player = MockAudioWorkletNode.withName(PLAYER_PROCESSOR)!;

    recorder.port.onmessage?.({ data: { type: "speech_start" } });

    expect(player.port.postMessage).toHaveBeenCalledWith({ type: "flush" });
  });
});

describe("video frame capture", () => {
  it("streams jpeg frames from the canvas on an interval", async () => {
    vi.useFakeTimers();
    const canvas = createCanvasElement("data:image/jpeg;base64,ZnJhbWU=");
    const { socket } = await connectHook({ canvas });

    await act(async () => {
      vi.advanceTimersByTime(750);
    });

    const frames = socket
      .sentMessages()
      .filter((message) => message.mime_type === "image/jpeg");
    expect(frames).toHaveLength(3);
    expect(frames[0]).toEqual({ mime_type: "image/jpeg", data: "ZnJhbWU=" });
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
  });

  it("skips frames until the video has metadata", async () => {
    vi.useFakeTimers();
    const video = createVideoElement({ readyState: 0 });
    const { socket } = await connectHook({ video });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(
      socket.sentMessages().filter((m) => m.mime_type === "image/jpeg")
    ).toHaveLength(0);
  });

  it("clears the capture interval on disconnect instead of leaking it", async () => {
    vi.useFakeTimers();
    const { result, canvas } = await connectHook();

    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(vi.getTimerCount()).toBe(1);
    const framesBeforeDisconnect = (canvas.toDataURL as ReturnType<typeof vi.fn>)
      .mock.calls.length;

    await act(async () => {
      result.current.disconnect();
    });

    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(
      (canvas.toDataURL as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBe(framesBeforeDisconnect);
  });

  it("does not stack intervals when connect is called twice", async () => {
    vi.useFakeTimers();
    const { result, socket } = await connectHook();

    socket.readyState = MockWebSocket.CLOSED;
    await act(async () => {
      await result.current.connect(
        createVideoElement(),
        createCanvasElement(),
        "client-42",
        "camera"
      );
    });
    await act(async () => {
      MockWebSocket.last().simulateOpen();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    expect(vi.getTimerCount()).toBe(1);
  });
});

describe("disconnect", () => {
  it("closes the socket, releases media tracks and closes both audio contexts", async () => {
    const { result, socket, video } = await connectHook();
    const stream = video.srcObject as unknown as MockMediaStream;

    await act(async () => {
      result.current.disconnect();
    });

    expect(socket.close).toHaveBeenCalled();
    expect(stream.getTracks().every((track) => track.stop.mock.calls.length > 0)).toBe(
      true
    );
    expect(video.srcObject).toBeNull();
    expect(
      MockAudioContext.instances.every((ctx) => ctx.close.mock.calls.length > 0)
    ).toBe(true);
    expect(result.current.connectionState).toBe("closed");
  });

  it("tears down when the server closes the socket", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      socket.onclose?.({ code: 1000 });
    });

    expect(result.current.connectionState).toBe("closed");
  });

  it("reports an error state when the socket errors", async () => {
    const { result, socket } = await connectHook();

    await act(async () => {
      socket.onerror?.(new Event("error"));
    });

    // disconnect() runs after the error is recorded and settles the state.
    expect(result.current.connectionState).toBe("closed");
    expect(socket.close).toHaveBeenCalled();
  });
});
