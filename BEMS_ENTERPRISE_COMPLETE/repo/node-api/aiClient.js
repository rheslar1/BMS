const path = require("path");

class AiClient {
  async health() {
    return { status: "disabled", service: "local-fallback" };
  }

  async optimize() {
    return null;
  }

  async feedback() {
    return null;
  }
}

class GrpcAiClient extends AiClient {
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
      this.client = new loaded.bems.ai.v1.AiOptimizationService(endpoint, grpc.credentials.createInsecure());
    } catch (error) {
      console.warn("AI gRPC client unavailable:", error.message);
    }
  }

  call(method, request) {
    if (!this.client) {
      return Promise.reject(new Error("AI gRPC client unavailable"));
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
      return await this.call("Health", {});
    } catch (error) {
      return { status: "unreachable", service: "python-ai-service", error: error.message };
    }
  }

  async optimize(payload) {
    try {
      const response = await this.call("Optimize", { payloadJson: JSON.stringify(payload) });
      return JSON.parse(response.optimizationJson);
    } catch (error) {
      console.warn("AI gRPC optimize failed:", error.message);
      return null;
    }
  }

  async feedback(payload) {
    try {
      const response = await this.call("Feedback", { payloadJson: JSON.stringify(payload) });
      return JSON.parse(response.feedbackJson);
    } catch (error) {
      console.warn("AI gRPC feedback failed:", error.message);
      return null;
    }
  }
}

function createAiClient() {
  const endpoint = process.env.AI_GRPC_ENDPOINT;
  if (!endpoint) {
    return new AiClient();
  }

  return new GrpcAiClient({
    endpoint,
    protoPath: path.join(__dirname, "..", "proto", "ai_service.proto"),
  });
}

module.exports = { createAiClient };
