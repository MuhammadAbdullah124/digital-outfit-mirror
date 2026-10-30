"""Local CPU pose tracker for the Fantasy Outfit Mirror."""

from __future__ import annotations

import asyncio
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import cv2
import mediapipe as mp
import numpy as np
import websockets
from websockets.exceptions import ConnectionClosed


HOST = "127.0.0.1"
PORT = int(os.environ.get("FANTASY_MIRROR_PORT", "8765"))
IMAGE_MAX_BYTES = 2 * 1024 * 1024
LANDMARK_COUNT = 33


class OneEuroFilter:
    """Adaptive low-pass filter: smooth at rest, responsive during movement."""

    def __init__(
        self,
        min_cutoff: float = 1.2,
        beta: float = 0.035,
        derivative_cutoff: float = 1.0,
    ) -> None:
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.derivative_cutoff = derivative_cutoff
        self.value: float | None = None
        self.derivative = 0.0
        self.timestamp: float | None = None

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def filter(self, value: float, timestamp: float) -> float:
        if self.value is None or self.timestamp is None:
            self.value = value
            self.timestamp = timestamp
            return value

        dt = max(1e-4, min(timestamp - self.timestamp, 0.25))
        raw_derivative = (value - self.value) / dt
        derivative_alpha = self._alpha(self.derivative_cutoff, dt)
        self.derivative += derivative_alpha * (raw_derivative - self.derivative)
        cutoff = self.min_cutoff + self.beta * abs(self.derivative)
        alpha = self._alpha(cutoff, dt)
        self.value += alpha * (value - self.value)
        self.timestamp = timestamp
        return self.value


class PoseTracker:
    def __init__(self) -> None:
        self.pose = mp.solutions.pose.Pose(
            static_image_mode=False,
            model_complexity=0,
            smooth_landmarks=False,
            enable_segmentation=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.filters: list[list[OneEuroFilter]] = []
        self.last_shoulder_angle: float | None = None
        self.last_angle_timestamp: float | None = None
        self.spin_until = 0.0

    def _reset_filters(self) -> None:
        self.filters = [
            [OneEuroFilter() for _ in range(4)] for _ in range(LANDMARK_COUNT)
        ]

    def process_frame(self, encoded: bytes) -> dict[str, Any]:
        image_buffer = np.frombuffer(encoded, dtype=np.uint8)
        image = cv2.imdecode(image_buffer, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("The WebSocket message was not a decodable image.")

        height, width = image.shape[:2]
        result = self.pose.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        now = time.perf_counter()
        if not result.pose_landmarks:
            self._reset_filters()
            self.last_shoulder_angle = None
            self.last_angle_timestamp = None
            return {
                "timestamp": now,
                "image": {"width": width, "height": height},
                "landmarks": [],
                "gestures": {"arm_raise": False, "spin": False},
            }

        if len(self.filters) != LANDMARK_COUNT:
            self._reset_filters()

        landmarks = []
        for index, landmark in enumerate(result.pose_landmarks.landmark):
            values = (landmark.x, landmark.y, landmark.z, landmark.visibility)
            filtered = [
                self.filters[index][axis].filter(float(value), now)
                for axis, value in enumerate(values)
            ]
            landmarks.append(
                {
                    "x": filtered[0],
                    "y": filtered[1],
                    "z": filtered[2],
                    "visibility": max(0.0, min(1.0, filtered[3])),
                }
            )

        nose = landmarks[0]
        left_wrist = landmarks[15]
        right_wrist = landmarks[16]
        arm_raise = (
            nose["visibility"] > 0.45
            and left_wrist["visibility"] > 0.45
            and right_wrist["visibility"] > 0.45
            and left_wrist["y"] < nose["y"]
            and right_wrist["y"] < nose["y"]
        )

        left_shoulder = landmarks[11]
        right_shoulder = landmarks[12]
        shoulder_angle: float | None = None
        if min(left_shoulder["visibility"], right_shoulder["visibility"]) > 0.45:
            shoulder_angle = math.atan2(
                right_shoulder["z"] - left_shoulder["z"],
                right_shoulder["x"] - left_shoulder["x"],
            )

        if shoulder_angle is not None and self.last_shoulder_angle is not None:
            dt = max(1e-4, now - (self.last_angle_timestamp or now))
            delta = (shoulder_angle - self.last_shoulder_angle + math.pi) % (
                2.0 * math.pi
            ) - math.pi
            if abs(delta / dt) > 2.5:
                self.spin_until = now + 0.65
        self.last_shoulder_angle = shoulder_angle
        self.last_angle_timestamp = now if shoulder_angle is not None else None

        return {
            "timestamp": now,
            "image": {"width": width, "height": height},
            "landmarks": landmarks,
            "gestures": {"arm_raise": arm_raise, "spin": now < self.spin_until},
        }

    def close(self) -> None:
        self.pose.close()


def allowed_origins() -> list[str | None]:
    configured = os.environ.get("FANTASY_MIRROR_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return [
        None,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]


async def serve_client(connection: Any, tracker: PoseTracker, executor: ThreadPoolExecutor):
    loop = asyncio.get_running_loop()
    try:
        async for message in connection:
            if not isinstance(message, bytes):
                await connection.send(
                    json.dumps({"error": "Expected a binary JPEG frame."})
                )
                continue
            if len(message) > IMAGE_MAX_BYTES:
                await connection.send(
                    json.dumps({"error": "Frame exceeds the 2 MB size limit."})
                )
                continue
            try:
                payload = await loop.run_in_executor(
                    executor, tracker.process_frame, message
                )
            except (ValueError, cv2.error) as error:
                await connection.send(json.dumps({"error": str(error)}))
                continue
            await connection.send(json.dumps(payload, separators=(",", ":")))
    except ConnectionClosed:
        pass


async def main() -> None:
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pose-inference")
    loop = asyncio.get_running_loop()
    tracker = await loop.run_in_executor(executor, PoseTracker)
    try:
        async with websockets.serve(
            lambda connection: serve_client(connection, tracker, executor),
            HOST,
            PORT,
            origins=allowed_origins(),
            max_size=IMAGE_MAX_BYTES,
            compression=None,
            ping_interval=20,
            ping_timeout=20,
        ):
            print(
                f"Pose tracker ready at ws://{HOST}:{PORT} "
                f"(CPU inference, One Euro filtering)",
                flush=True,
            )
            await asyncio.Future()
    finally:
        await loop.run_in_executor(executor, tracker.close)
        executor.shutdown(wait=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nPose tracker stopped.", file=sys.stderr)
