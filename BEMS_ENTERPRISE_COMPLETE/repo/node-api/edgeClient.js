const path = require("path");

const defaultForecast = [
  { interval: "next_hour", predictedKwh: 12.8, estimatedCost: 1.79, recommendation: "Maintain current temperature setpoint" },
  { interval: "hour_2", predictedKwh: 13.3, estimatedCost: 1.86, recommendation: "Slightly reduce cooling on floor 1" },
  { interval: "hour_3", predictedKwh: 13.9, estimatedCost: 1.95, recommendation: "Prepare for peak demand" },
];

class EdgeClient {
  async health() {
    return { status: "disabled", edgeVersion: "local-fallback" };
  }

  async getEnergyForecast() {
    return { source: "local-fallback", forecast: defaultForecast };
  }

  async discoverDevices() {
    return {
      source: "local-fallback",
      devices: [],
      message: "Edge gRPC client is not enabled; BACnet discovery requires the edge core.",
    };
  }

  async readPoint() {
    return { value: null, units: "", status: "disabled", message: "Edge gRPC client is not enabled." };
  }

  async writePoint() {
    return { accepted: false, message: "Edge gRPC client is not enabled." };
  }
}

class GrpcEdgeClient extends EdgeClient {
  constructor({ endpoint, protoPath }) {
    super();
    this.endpoint = endpoint;
    this.client = null;

    try {
      const grpc = require("@grpc/grpc-js");
      const protoLoader = require("@grpc/proto-loader");
      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      const loaded = grpc.loadPackageDefinition(packageDefinition);
      this.client = new loaded.bems.edge.v1.EdgeCoreService(endpoint, grpc.credentials.createInsecure());
    } catch (error) {
      console.warn("Edge gRPC client unavailable, using local fallback:", error.message);
    }
  }

  call(method, request) {
    if (!this.client) {
      return Promise.reject(new Error("Edge gRPC client unavailable"));
    }

    return new Promise((resolve, reject) => {
      this.client[method](request, (error, response) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
  }

  async health() {
    try {
      const response = await this.call("Health", {});
      return { status: response.status, edgeVersion: response.edgeVersion };
    } catch (error) {
      return { status: "unreachable", edgeVersion: "unknown", error: error.message };
    }
  }

  async getEnergyForecast(hours = 3) {
    try {
      const response = await this.call("GetEnergyForecast", { hours });
      return {
        source: `edge-grpc:${this.endpoint}`,
        forecast: response.forecast.map((entry) => ({
          interval: entry.interval,
          predictedKwh: entry.predictedKwh,
          estimatedCost: entry.estimatedCost,
          recommendation: entry.recommendation,
        })),
      };
    } catch (error) {
      return { source: "local-fallback", forecast: defaultForecast, edgeError: error.message };
    }
  }

  async discoverDevices(lowInstance = 1, highInstance = 4194303) {
    try {
      const response = await this.call("DiscoverDevices", { lowInstance, highInstance });
      return { source: `edge-grpc:${this.endpoint}`, devices: response.devices || [] };
    } catch (error) {
      return { source: "local-fallback", devices: [], edgeError: error.message };
    }
  }

  async readPoint(request) {
    try {
      return await this.call("ReadPoint", request);
    } catch (error) {
      return { value: null, units: "", status: "unreachable", message: error.message };
    }
  }

  async writePoint(request) {
    try {
      return await this.call("WritePoint", request);
    } catch (error) {
      return { accepted: false, message: error.message };
    }
  }
}

function createEdgeClient() {
  const endpoint = process.env.EDGE_GRPC_ENDPOINT;
  if (!endpoint) {
    return new EdgeClient();
  }

  return new GrpcEdgeClient({
    endpoint,
    protoPath: path.join(__dirname, "..", "proto", "edge_service.proto"),
  });
}

module.exports = { createEdgeClient };
