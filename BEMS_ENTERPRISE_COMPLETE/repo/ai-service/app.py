from http.server import BaseHTTPRequestHandler, HTTPServer
from json import dumps, loads
from math import fabs
from concurrent import futures
from os import environ
from pathlib import Path
import sys
import threading
from time import time

import grpc

generated_dir = Path(__file__).resolve().parent / "generated"
sys.path.insert(0, str(generated_dir))

import ai_service_pb2
import ai_service_pb2_grpc


RL_ACTIONS = [-1.5, -0.5, 0, 0.5, 1.5]
Q_VALUES = {}


def clamp(value, low, high):
    if low is not None and value < low:
        return low
    if high is not None and value > high:
        return high
    return value


def q_key(zone_id, action):
    return f"{zone_id}:{action}"


def q_value(zone_id, action):
    return Q_VALUES.get(q_key(zone_id, action), 0.0)


def best_action(zone_id):
    return max(RL_ACTIONS, key=lambda action: q_value(zone_id, action))


def mode_bias(profile):
    return {
        "Conservative": 1.5,
        "Normal": 0.0,
        "Aggressive": -1.0,
    }.get(profile, 0.0)


def optimize(payload):
    mode = payload.get("mode", {})
    rows = payload.get("rows", [])
    profile = mode.get("profile", "Normal")
    zones = {}

    for row in rows:
        zone_id = row.get("zoneId")
        zones.setdefault(zone_id, {
            "zoneId": zone_id,
            "zoneName": row.get("zoneName"),
            "buildingName": row.get("buildingName"),
            "devices": [],
        })
        zones[zone_id]["devices"].append(row)

    zone_plans = []
    for zone in zones.values():
        learned_action = best_action(zone["zoneId"])
        coordinated_delta = round(mode_bias(profile) + learned_action, 2)
        devices = []

        for device in zone["devices"]:
            config = device.get("configuration") or {}
            current_setpoint = float(config.get("setpoint") or device.get("value") or 0)
            target = clamp(
                current_setpoint + coordinated_delta,
                config.get("minSetpoint"),
                config.get("maxSetpoint"),
            )
            energy_savings = max(0.1, fabs(target - current_setpoint) * 0.44)
            comfort_penalty = fabs((device.get("value") or current_setpoint) - current_setpoint)
            devices.append({
                "deviceId": device.get("deviceId"),
                "deviceName": device.get("deviceName"),
                "currentSetpoint": round(current_setpoint, 2),
                "targetSetpoint": round(target, 2),
                "energySavings": round(energy_savings, 2),
                "comfortPenalty": round(comfort_penalty, 2),
            })

        energy = sum(device["energySavings"] for device in devices)
        comfort = sum(device["comfortPenalty"] for device in devices) / max(1, len(devices))
        cost = energy * 0.14
        score = (energy * 0.45) + (cost * 0.35) - (comfort * 0.2)
        zone_plans.append({
            "zoneId": zone["zoneId"],
            "zoneName": zone["zoneName"],
            "buildingName": zone["buildingName"],
            "learnedAction": learned_action,
            "coordinatedDelta": coordinated_delta,
            "objectiveScore": round(score, 3),
            "energySavingsKwh": round(energy, 2),
            "costSavings": round(cost, 2),
            "comfortPenalty": round(comfort, 2),
            "devices": devices,
        })

    total_energy = sum(zone["energySavingsKwh"] for zone in zone_plans)
    return {
        "source": "python-ai-service",
        "generatedAt": time(),
        "mode": mode,
        "objective": {
            "energyWeight": 0.45,
            "comfortWeight": 0.2,
            "costWeight": 0.35,
            "estimatedSavingsKwh": round(total_energy, 2),
            "estimatedCostSavings": round(total_energy * 0.14, 2),
        },
        "learning": {
            "algorithm": "epsilon_greedy_q_learning",
            "actions": RL_ACTIONS,
            "stateCount": len(Q_VALUES),
        },
        "zonePlans": zone_plans,
    }


def feedback(payload):
    zone_id = payload["zoneId"]
    action = payload["action"]
    reward = float(payload["reward"])
    key = q_key(zone_id, action)
    current = Q_VALUES.get(key, 0.0)
    Q_VALUES[key] = round(current + 0.22 * (reward - current), 4)
    return {"zoneId": zone_id, "action": action, "reward": reward, "qValue": Q_VALUES[key]}


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        encoded = dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        return loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "service": "python-ai-service"})
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        try:
            payload = self.read_json()
            if self.path == "/optimize":
                self.send_json(200, optimize(payload))
            elif self.path == "/feedback":
                self.send_json(200, feedback(payload))
            else:
                self.send_json(404, {"error": "Not found"})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})


class AiOptimizationServicer(ai_service_pb2_grpc.AiOptimizationServiceServicer):
    def Health(self, request, context):
        return ai_service_pb2.AiHealthResponse(status="ok", service="python-ai-service")

    def Optimize(self, request, context):
        result = optimize(loads(request.payload_json or "{}"))
        return ai_service_pb2.OptimizeResponse(optimization_json=dumps(result))

    def Feedback(self, request, context):
        result = feedback(loads(request.payload_json or "{}"))
        return ai_service_pb2.FeedbackResponse(feedback_json=dumps(result))


def serve_http():
    port = int(environ.get("AI_HTTP_PORT", "8000"))
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()


def serve_grpc():
    port = int(environ.get("AI_GRPC_PORT", "50052"))
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    ai_service_pb2_grpc.add_AiOptimizationServiceServicer_to_server(AiOptimizationServicer(), server)
    server.add_insecure_port(f"0.0.0.0:{port}")
    server.start()
    server.wait_for_termination()


if __name__ == "__main__":
    threading.Thread(target=serve_http, daemon=True).start()
    serve_grpc()
