import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  MockAudioContext,
  MockAudioWorkletNode,
  MockMediaStream,
  MockWebSocket,
  resetMocks,
} from "./mocks";

vi.stubGlobal("AudioContext", MockAudioContext);
vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
vi.stubGlobal("MediaStream", MockMediaStream);
vi.stubGlobal("WebSocket", MockWebSocket);

Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  writable: true,
  value: {
    getUserMedia: vi.fn(),
    getDisplayMedia: vi.fn(),
  },
});

if (typeof crypto.randomUUID !== "function") {
  let counter = 0;
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    writable: true,
    value: () => `00000000-0000-4000-8000-${String(counter++).padStart(12, "0")}`,
  });
}

beforeEach(() => {
  resetMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "trace").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
