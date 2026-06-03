const amqp = require("amqplib");

const defaultForecast = [
  { interval: "next_hour", predictedKwh: 12.8, estimatedCost: 1.79, recommendation: "Maintain current temperature setpoint" },
  { interval: "hour_2", predictedKwh: 13.3, estimatedCost: 1.86, recommendation: "Slightly reduce cooling on floor 1" },
  { interval: "hour_3", predictedKwh: 13.9, estimatedCost: 1.95, recommendation: "Prepare for peak demand" },
];

class RabbitMqEdgeClient {
  constructor({
    rabbitUrl = process.env.RABBITMQ_URL || "",
    exchange = process.env.RABBITMQ_EXCHANGE || "bems.events",
    commandTopic = "bems.edge.commands",
  } = {}) {
    this.rabbitUrl = rabbitUrl;
    this.exchange = exchange;
    this.commandTopic = commandTopic;
    this.connection = null;
    this.channel = null;
    this.connecting = null;
    this.lastError = null;
  }

  async getChannel() {
    if (!this.rabbitUrl) {
      throw new Error("RABBITMQ_URL is not configured");
    }
    if (this.channel) {
      return this.channel;
    }
    if (!this.connecting) {
      this.connecting = amqp.connect(this.rabbitUrl)
        .then(async (connection) => {
          this.connection = connection;
          this.connection.on("error", (error) => {
            this.lastError = error.message;
            this.connection = null;
            this.channel = null;
            this.connecting = null;
          });
          this.channel = await connection.createChannel();
          await this.channel.assertExchange(this.exchange, "topic", { durable: true });
          this.lastError = null;
          return this.channel;
        })
        .catch((error) => {
          this.lastError = error.message;
          this.connection = null;
          this.channel = null;
          this.connecting = null;
          throw error;
        });
    }
    return this.connecting;
  }

  async queue(commandType, payload = {}, key = commandType) {
    const message = {
      commandId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      commandType,
      payload,
      transport: "rabbitmq",
      queuedAt: new Date().toISOString(),
    };

    try {
      const channel = await this.getChannel();
      const routingKey = this.commandTopic.replace(/^bems\./, "");
      const published = channel.publish(
        this.exchange,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
          contentType: "application/json",
          deliveryMode: 2,
          messageId: message.commandId,
          correlationId: key == null ? message.commandId : String(key),
          timestamp: Math.floor(Date.now() / 1000),
          type: commandType,
        }
      );
      return {
        accepted: published,
        status: published ? "queued" : "backpressure",
        transport: "rabbitmq",
        exchange: this.exchange,
        routingKey,
        command: message,
      };
    } catch (error) {
      return {
        accepted: false,
        status: "unavailable",
        transport: "rabbitmq",
        message: error.message,
      };
    }
  }

  async health() {
    if (!this.rabbitUrl) {
      return { status: "disabled", edgeVersion: "rabbitmq-edge-client", transport: "rabbitmq", message: "RABBITMQ_URL is not configured" };
    }
    try {
      await this.getChannel();
      return { status: "ready", edgeVersion: "rabbitmq-edge-client", transport: "rabbitmq", exchange: this.exchange };
    } catch (error) {
      return { status: "unreachable", edgeVersion: "rabbitmq-edge-client", transport: "rabbitmq", error: error.message };
    }
  }

  async getEnergyForecast(hours = 3) {
    const queued = await this.queue("edge.energy_forecast", { hours }, `forecast:${hours}`);
    return {
      source: "rabbitmq-edge-command",
      queued,
      forecast: defaultForecast,
      message: "Forecast request queued to RabbitMQ; local fallback forecast returned for synchronous API response.",
    };
  }

  async discoverDevices(lowInstance = 1, highInstance = 4194303) {
    const queued = await this.queue("bacnet.discover_devices", { lowInstance, highInstance }, `${lowInstance}:${highInstance}`);
    return {
      source: "rabbitmq-edge-command",
      devices: [],
      queued,
      message: "BACnet discovery request queued to RabbitMQ; discovered devices arrive through telemetry/provisioning events.",
    };
  }

  async readPoint(request) {
    const queued = await this.queue("bacnet.read_property", request, `${request.deviceInstance}:${request.objectType}:${request.objectInstance}`);
    return {
      value: null,
      units: "",
      status: queued.accepted ? "queued" : "unavailable",
      transport: "rabbitmq",
      queued,
      message: "BACnet ReadProperty queued to RabbitMQ; point value updates arrive through telemetry events.",
    };
  }

  async readPoints(request = {}) {
    const queued = await this.queue("bacnet.read_property_multiple", request, `batch:${Date.now()}`);
    return {
      strategy: "rabbitmq_read_property_multiple_event_response",
      transport: "rabbitmq",
      queued,
      results: (request.points || []).map((point) => ({
        ...point,
        success: false,
        value: null,
        units: "",
        status: queued.accepted ? "queued" : "unavailable",
        error: queued.accepted ? "" : queued.message,
        attempts: 0,
        offline: false,
      })),
    };
  }

  async writePoint(request) {
    return this.queue("bacnet.write_property", request, `${request.deviceInstance}:${request.objectType}:${request.objectInstance}`);
  }

  async subscribeCov(request) {
    return this.queue("bacnet.subscribe_cov", request, `${request.deviceInstance}:${request.objectType}:${request.objectInstance}`);
  }
}

function createEdgeClient() {
  return new RabbitMqEdgeClient();
}

module.exports = { createEdgeClient, RabbitMqEdgeClient };
