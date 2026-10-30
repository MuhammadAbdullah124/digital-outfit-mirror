import { useCallback, useEffect, useRef, useState } from "react";
import MirrorScene, { type PoseFrame } from "./MirrorScene";

const WS_URL = "ws://127.0.0.1:8765";
const FRAME_INTERVAL_MS = 50;

type ConnectionState = "offline" | "connecting" | "connected" | "error";

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const lastFrameAtRef = useRef(0);
  const [pose, setPose] = useState<PoseFrame | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [error, setError] = useState("");

  const stop = useCallback(() => {
    if (frameTimerRef.current !== null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    socketRef.current?.close();
    socketRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    sendingRef.current = false;
    setPose(null);
    setConnection("offline");
  }, []);

  const start = useCallback(async () => {
    setError("");
    setConnection("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("The video preview is unavailable.");
      video.srcObject = stream;
      await video.play();

      const socket = new WebSocket(WS_URL);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        setConnection("connected");
        const captureCanvas = captureCanvasRef.current;
        const context = captureCanvas?.getContext("2d", { alpha: false });
        if (!captureCanvas || !context || !video.videoWidth) {
          setError("Could not initialize webcam frame capture.");
          stop();
          return;
        }
        captureCanvas.width = 640;
        captureCanvas.height = Math.round(
          (640 * video.videoHeight) / video.videoWidth,
        );
        frameTimerRef.current = window.setInterval(() => {
          if (
            socket.readyState !== WebSocket.OPEN ||
            video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
            sendingRef.current ||
            socket.bufferedAmount > 256 * 1024
          ) {
            return;
          }
          const now = performance.now();
          if (now - lastFrameAtRef.current < FRAME_INTERVAL_MS) return;
          lastFrameAtRef.current = now;
          sendingRef.current = true;
          context.drawImage(
            video,
            0,
            0,
            captureCanvas.width,
            captureCanvas.height,
          );
          captureCanvas.toBlob(
            (blob) => {
              sendingRef.current = false;
              if (blob && socket.readyState === WebSocket.OPEN) {
                socket.send(blob);
              }
            },
            "image/jpeg",
            0.68,
          );
        }, 16);
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          const message = JSON.parse(event.data) as PoseFrame | { error: string };
          if ("error" in message) {
            setError(message.error);
            return;
          }
          setPose(message);
        } catch {
          setError("Received an invalid tracking response.");
        }
      };
      socket.onerror = () => {
        setError("Could not connect to the local pose tracker.");
        setConnection("error");
      };
      socket.onclose = () => {
        if (streamRef.current) {
          setConnection("error");
          setError("Pose tracker disconnected. Restart the backend and try again.");
        }
      };
    } catch (reason) {
      stop();
      setConnection("error");
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not start the webcam or connect to the tracker.",
      );
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  const tracked = Boolean(pose?.landmarks.length);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Fantasy Outfit Mirror home">
          <span className="brand-mark">✦</span>
          <span>MYTHIC <b>MIRROR</b></span>
        </a>
        <div className={`connection ${connection}`}>
          <span className="status-dot" />
          {connection === "connected"
            ? "LOCAL TRACKER CONNECTED"
            : connection === "connecting"
              ? "CONNECTING"
              : connection === "error"
                ? "CONNECTION ERROR"
                : "TRACKER OFFLINE"}
        </div>
      </header>

      <section className="stage" aria-label="Live fantasy outfit mirror">
        <video ref={videoRef} className="webcam" muted playsInline />
        <canvas ref={captureCanvasRef} className="capture-canvas" />
        <MirrorScene pose={pose} />
        {!tracked && (
          <div className="empty-state">
            <div className="sigil">✧</div>
            <h1>Step into another world.</h1>
            <p>
              Allow camera access and connect the local tracker to try on your
              fantasy armor.
            </p>
            {connection === "connected" && (
              <span className="tracking-hint">
                {pose ? "Move into view to begin tracking" : "Finding you…"}
              </span>
            )}
          </div>
        )}
        {tracked && (
          <div className="live-tag">
            <span className="status-dot" />
            LIVE TRACKING
          </div>
        )}
        <div className="corner-label">
          <span>REALITY / 001</span>
          <span>CPU POSE TRACKING</span>
        </div>
      </section>

      <footer className="controls">
        <div className="control-copy">
          <strong>THE WAYFARER</strong>
          <span>Steelbound · Arcane collection</span>
        </div>
        {error && <p className="error-message" role="alert">{error}</p>}
        {connection === "connected" ? (
          <button className="action-button secondary" onClick={stop}>
            Disconnect
          </button>
        ) : (
          <button
            className="action-button"
            onClick={() => void start()}
            disabled={connection === "connecting"}
          >
            {connection === "connecting" ? "Connecting…" : "Enable mirror"}
            <span aria-hidden="true"> ↗</span>
          </button>
        )}
      </footer>
      <p className="privacy-note">
        Video frames are processed locally and are not recorded or uploaded.
      </p>
    </main>
  );
}

export default App;
