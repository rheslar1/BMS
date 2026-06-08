#include "edge_service.h"
#include "logger.h"
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <csignal>
#include <cstdlib>
#include <mutex>
#include <pthread.h>
#include <string>
#include <thread>

namespace {

std::atomic_bool shutdownRequested{false};
std::condition_variable shutdownCondition;
std::mutex shutdownMutex;

bool envEnabled(const char *name) {
  const char *value = std::getenv(name);
  if (!value) return false;
  const std::string normalized(value);
  return normalized == "1" || normalized == "true" || normalized == "TRUE" || normalized == "yes" || normalized == "on";
}

unsigned short envPort(const char *name, unsigned short fallback) {
  const char *value = std::getenv(name);
  if (!value || !*value) return fallback;

  const int parsed = std::atoi(value);
  if (parsed < 0 || parsed > 65535) return fallback;
  return static_cast<unsigned short>(parsed);
}

void notifyShutdown() {
  {
    std::lock_guard<std::mutex> lock(shutdownMutex);
    shutdownRequested.store(true);
  }
  shutdownCondition.notify_all();
}

} // namespace

int main() {
  sigset_t signalSet;
  sigemptyset(&signalSet);
  sigaddset(&signalSet, SIGINT);
  sigaddset(&signalSet, SIGTERM);
  pthread_sigmask(SIG_BLOCK, &signalSet, nullptr);

  std::thread signalThread([&signalSet]() {
    int signalNumber = 0;
    if (sigwait(&signalSet, &signalNumber) == 0) {
      notifyShutdown();
    }
  });

  const char *localIp = std::getenv("BACNET_LOCAL_IP");
  EdgeServiceConfig config = makeDefaultEdgeServiceConfig(
      localIp && *localIp ? std::string(localIp) : "0.0.0.0",
      envPort("BACNET_LOCAL_PORT", 47808),
      envEnabled("EDGE_POLLING_ENABLED"),
      std::chrono::seconds(10));
  EdgeService service(config);

  if (!service.start()) {
    notifyShutdown();
    if (signalThread.joinable()) {
      pthread_kill(signalThread.native_handle(), SIGTERM);
      signalThread.join();
    }
    return 1;
  }

  Logger::info("Edge runtime ready for RabbitMQ AMQP command orchestration and BACnet/IP field integration");
  {
    std::unique_lock<std::mutex> lock(shutdownMutex);
    shutdownCondition.wait(lock, []() {
      return shutdownRequested.load();
    });
  }

  Logger::info("shutdown requested");
  service.stop();
  if (signalThread.joinable()) {
    signalThread.join();
  }
  return 0;
}
