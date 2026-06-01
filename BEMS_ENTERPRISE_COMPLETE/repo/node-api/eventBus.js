const { Kafka } = require("kafkajs");
const mqtt = require("mqtt");
const amqp = require("amqplib");

function createEventBus(options = {}) {
  const brokers = String(options.brokers || process.env.KAFKA_BROKERS || "")
    .split(",")
    .map((broker) => broker.trim())
    .filter(Boolean);
  const clientId = options.clientId || process.env.KAFKA_CLIENT_ID || "bems-node-api";
  const mqttBrokerUrl = options.mqttBrokerUrl || process.env.MQTT_BROKER_URL || "";
  const mqttTopicPrefix = options.mqttTopicPrefix || process.env.MQTT_TOPIC_PREFIX || "bems";
  const mqttUsername = options.mqttUsername || process.env.MQTT_USERNAME || "";
  const mqttPassword = options.mqttPassword || process.env.MQTT_PASSWORD || "";
  const rabbitUrl = options.rabbitUrl || process.env.RABBITMQ_URL || "";
  const rabbitExchange = options.rabbitExchange || process.env.RABBITMQ_EXCHANGE || "bems.events";
  const kafkaEnabled = brokers.length > 0;
  const mqttEnabled = !!mqttBrokerUrl;
  const rabbitEnabled = !!rabbitUrl;
  const enabled = kafkaEnabled || mqttEnabled || rabbitEnabled;
  let producer = null;
  let mqttClient = null;
  let rabbitConnection = null;
  let rabbitChannel = null;
  let mqttConnectPromise = null;
  let rabbitConnectPromise = null;
  let connectPromise = null;
  let lastError = null;
  let mqttLastError = null;
  let rabbitLastError = null;

  async function getProducer() {
    if (!kafkaEnabled) return null;
    if (producer) return producer;
    if (!connectPromise) {
      const kafka = new Kafka({ clientId, brokers });
      producer = kafka.producer();
      connectPromise = producer.connect().catch((error) => {
        lastError = error.message;
        producer = null;
        connectPromise = null;
        throw error;
      });
    }
    await connectPromise;
    return producer;
  }

  async function getMqttClient() {
    if (!mqttEnabled) return null;
    if (mqttClient?.connected) return mqttClient;
    if (!mqttConnectPromise) {
      mqttClient = mqtt.connect(mqttBrokerUrl, {
        clientId: process.env.MQTT_CLIENT_ID || `${clientId}-mqtt`,
        username: mqttUsername || undefined,
        password: mqttPassword || undefined,
        protocolVersion: 5,
        reconnectPeriod: 10000,
      });
      mqttConnectPromise = new Promise((resolve, reject) => {
        mqttClient.once("connect", () => {
          mqttLastError = null;
          resolve(mqttClient);
        });
        mqttClient.once("error", (error) => {
          mqttLastError = error.message;
          reject(error);
        });
      }).catch((error) => {
        mqttClient = null;
        mqttConnectPromise = null;
        throw error;
      });
    }
    return mqttConnectPromise;
  }

  async function getRabbitChannel() {
    if (!rabbitEnabled) return null;
    if (rabbitChannel) return rabbitChannel;
    if (!rabbitConnectPromise) {
      rabbitConnectPromise = amqp.connect(rabbitUrl)
        .then(async (connection) => {
          rabbitConnection = connection;
          rabbitConnection.on("error", (error) => {
            rabbitLastError = error.message;
            rabbitConnection = null;
            rabbitChannel = null;
            rabbitConnectPromise = null;
          });
          rabbitChannel = await rabbitConnection.createChannel();
          await rabbitChannel.assertExchange(rabbitExchange, "topic", { durable: true });
          rabbitLastError = null;
          return rabbitChannel;
        })
        .catch((error) => {
          rabbitLastError = error.message;
          rabbitConnection = null;
          rabbitChannel = null;
          rabbitConnectPromise = null;
          throw error;
        });
    }
    return rabbitConnectPromise;
  }

  async function publish(topic, event, key = null) {
    if (!enabled) {
      return { published: false, reason: "disabled" };
    }

    const payload = JSON.stringify({
      ...event,
      publishedAt: new Date().toISOString(),
    });
    const results = [];

    try {
      if (kafkaEnabled) {
        const activeProducer = await getProducer();
        await activeProducer.send({
          topic,
          messages: [
            {
              key: key == null ? undefined : String(key),
              value: payload,
            },
          ],
        });
        lastError = null;
        results.push({ transport: "kafka", published: true });
      }
    } catch (error) {
      lastError = error.message;
      console.error(`Kafka publish failed for ${topic}:`, error.message);
      results.push({ transport: "kafka", published: false, reason: error.message });
    }

    try {
      if (mqttEnabled) {
        const activeMqttClient = await getMqttClient();
        const mqttTopic = `${mqttTopicPrefix}/${topic.replace(/\./g, "/")}`;
        await new Promise((resolve, reject) => {
          activeMqttClient.publish(mqttTopic, payload, { qos: 1 }, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        mqttLastError = null;
        results.push({ transport: "mqtt_tls", topic: mqttTopic, published: true });
      }
    } catch (error) {
      mqttLastError = error.message;
      console.error(`MQTT publish failed for ${topic}:`, error.message);
      results.push({ transport: "mqtt_tls", published: false, reason: error.message });
    }

    try {
      if (rabbitEnabled) {
        const activeRabbitChannel = await getRabbitChannel();
        const routingKey = topic.replace(/^bems\./, "").replace(/\./g, ".");
        const ok = activeRabbitChannel.publish(
          rabbitExchange,
          routingKey,
          Buffer.from(payload),
          {
            contentType: "application/json",
            deliveryMode: 2,
            messageId: key == null ? undefined : String(key),
            timestamp: Math.floor(Date.now() / 1000),
          }
        );
        rabbitLastError = null;
        results.push({ transport: "rabbitmq_amqp", exchange: rabbitExchange, routingKey, published: ok });
      }
    } catch (error) {
      rabbitLastError = error.message;
      console.error(`RabbitMQ publish failed for ${topic}:`, error.message);
      results.push({ transport: "rabbitmq_amqp", published: false, reason: error.message });
    }

    return {
      published: results.some((result) => result.published),
      results,
    };
  }

  return {
    enabled,
    brokers,
    clientId,
    publish,
    status() {
      return {
        enabled,
        kafka: {
          enabled: kafkaEnabled,
          brokers,
          clientId,
          connected: !!producer && !lastError,
          lastError,
        },
        mqtt: {
          enabled: mqttEnabled,
          brokerUrl: mqttBrokerUrl || null,
          topicPrefix: mqttTopicPrefix,
          connected: !!mqttClient?.connected && !mqttLastError,
          lastError: mqttLastError,
        },
        rabbitmq: {
          enabled: rabbitEnabled,
          url: rabbitUrl ? rabbitUrl.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@") : null,
          exchange: rabbitExchange,
          connected: !!rabbitChannel && !rabbitLastError,
          lastError: rabbitLastError,
        },
      };
    },
  };
}

module.exports = { createEventBus };
