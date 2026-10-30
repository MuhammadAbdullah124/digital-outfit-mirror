# Fantasy Outfit Mirror

A local webcam-to-WebSocket pose pipeline with a React Three Fiber fantasy
armor/VFX overlay. Webcam images stay on the device; Python runs MediaPipe Pose
with a One Euro filter and sends normalized joint coordinates back to the
browser.

## Run locally

1. Install Python dependencies: `python -m pip install -r requirements.txt`
2. Start the tracker from the project root: `python app.py`
3. In `frontend`, install packages and start Vite: `npm install` then `npm run dev`
4. Open the Vite URL (normally `http://127.0.0.1:5173`) and select **Enable mirror**.

Python binds only to `127.0.0.1:8765`. The server accepts browser origins on
localhost ports 5173 and 4173 by default. Override the list with a
comma-separated `FANTASY_MIRROR_ORIGINS` environment variable or the port with
`FANTASY_MIRROR_PORT`.

The browser sends resized JPEG frames (up to 640 pixels wide) at approximately
20 frames per second; the backend returns 33 smoothed landmarks and gesture
state. The arm-raise gesture compares image-space wrist Y against nose Y
(smaller image Y means a raised wrist). Spin is estimated from shoulder X/Z
angular velocity. CPU use, webcam drivers, browser scheduling, and network
transport affect latency, so sub-100 ms is a target rather than a guarantee.

The outfit is composed of low-poly Three.js geometry so the project runs
without downloading or bundling third-party models. Replace those geometry
groups with locally supplied GLTF assets as desired. No GLTF assets are
included in this starter.
