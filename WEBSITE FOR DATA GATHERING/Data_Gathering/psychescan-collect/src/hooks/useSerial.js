import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONFIG } from "../config.js";
import { parseSensorLine, splitLines } from "../lib/serialParser.js";

/**
 * Web Serial connection to the ESP32 (spec Sections 3.4, 4, 6.3).
 * Parsed readings go into latestSensorRef only (never React state).
 * In development builds, startSim() feeds fake JSON lines through the same parser.
 */
export function useSerial(latestSensorRef, onEvent) {
  const portRef = useRef(null);
  const readerRef = useRef(null);
  const keepReadingRef = useRef(false);
  const loopRef = useRef(null);
  const bufferRef = useRef("");
  const decoderRef = useRef(null);
  const simTimerRef = useRef(null);
  const onEventRef = useRef(onEvent);
  const [connected, setConnected] = useState(false);
  const [simulated, setSimulated] = useState(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const feed = useCallback(
    (text) => {
      const { lines, rest } = splitLines(bufferRef.current, text, CONFIG.serial.maxLineBytes);
      bufferRef.current = rest;
      for (const line of lines) {
        const data = parseSensorLine(line);
        if (data) latestSensorRef.current = { ...data, receivedAt: performance.now() };
      }
    },
    [latestSensorRef]
  );

  const readLoop = useCallback(
    async (port) => {
      // Web Serial pattern: a non-fatal error (e.g. framing) gives a new
      // port.readable; a fatal one (USB unplugged) sets it to null.
      while (keepReadingRef.current && port.readable) {
        const reader = port.readable.getReader();
        readerRef.current = reader;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            feed(decoderRef.current.decode(value, { stream: true }));
          }
        } catch (e) {
          console.warn("[serial] read error:", e);
          onEventRef.current?.("serial_error", String(e?.message || e));
        } finally {
          reader.releaseLock();
          readerRef.current = null;
        }
      }
      try {
        await port.close();
      } catch {
        // already closed or device gone
      }
      if (portRef.current === port) {
        portRef.current = null;
        setConnected(false);
        onEventRef.current?.("serial_closed", "");
      }
    },
    [feed]
  );

  const openPort = useCallback(
    async (port) => {
      await port.open({ baudRate: CONFIG.serial.baudRate });
      portRef.current = port;
      keepReadingRef.current = true;
      bufferRef.current = "";
      decoderRef.current = new TextDecoder();
      setConnected(true);
      onEventRef.current?.("serial_connected", "");
      loopRef.current = readLoop(port);
    },
    [readLoop]
  );

  /** "Connect USB": always shows the browser's port chooser. */
  const connect = useCallback(async () => {
    if (!("serial" in navigator)) throw new Error("Web Serial is not available. Use Chrome or Edge.");
    if (portRef.current || simTimerRef.current) return;
    const port = await navigator.serial.requestPort();
    await openPort(port);
  }, [openPort]);

  /** "Reconnect": reuse a port this site was already allowed to use, else ask. */
  const reconnect = useCallback(async () => {
    if (!("serial" in navigator)) throw new Error("Web Serial is not available. Use Chrome or Edge.");
    if (portRef.current || simTimerRef.current) return;
    const ports = await navigator.serial.getPorts();
    for (const port of ports) {
      try {
        await openPort(port);
        return;
      } catch {
        // try the next one
      }
    }
    await openPort(await navigator.serial.requestPort());
  }, [openPort]);

  const disconnect = useCallback(async () => {
    keepReadingRef.current = false;
    try {
      await readerRef.current?.cancel();
    } catch {
      // ignore
    }
    await loopRef.current;
  }, []);

  // DEV ONLY: fake sensor stream. In a production build import.meta.env.DEV is
  // false, so the whole block (and the simulator module) is removed.
  const startSim = useCallback(async () => {
    if (import.meta.env.DEV) {
      if (portRef.current || simTimerRef.current) return;
      const { createSimSensor } = await import("../lib/simSensor.js");
      const nextLine = createSimSensor();
      bufferRef.current = "";
      simTimerRef.current = setInterval(() => feed(nextLine() + "\n"), 1000);
      setSimulated(true);
      setConnected(true);
      onEventRef.current?.("sim_sensors_on", "dev-only simulated sensor lines");
    }
  }, [feed]);

  const stopSim = useCallback(() => {
    if (!simTimerRef.current) return;
    clearInterval(simTimerRef.current);
    simTimerRef.current = null;
    setSimulated(false);
    setConnected(false);
    onEventRef.current?.("sim_sensors_off", "");
  }, []);

  // Cleanup on unmount: stop reading, close the port, stop the simulator.
  useEffect(
    () => () => {
      keepReadingRef.current = false;
      readerRef.current?.cancel().catch(() => {});
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    },
    []
  );

  return useMemo(
    () => ({ connect, reconnect, disconnect, startSim, stopSim, connected, simulated, portRef }),
    [connect, reconnect, disconnect, startSim, stopSim, connected, simulated]
  );
}
