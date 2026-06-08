#include "bounded_queue.h"

#include <atomic>
#include <cassert>
#include <chrono>
#include <thread>
#include <vector>

void testProducerConsumerPreservesItems() {
    BoundedQueue<int> queue(2);
    std::vector<int> consumed;

    std::thread producer([&queue]() {
        assert(queue.push(1));
        assert(queue.push(2));
        assert(queue.push(3));
        queue.close();
    });

    std::thread consumer([&queue, &consumed]() {
        int value = 0;
        while (queue.pop(value)) {
            consumed.push_back(value);
        }
    });

    producer.join();
    consumer.join();

    assert((consumed == std::vector<int>{1, 2, 3}));
    assert(queue.closed());
}

void testBlockedConsumerShutsDownGracefully() {
    BoundedQueue<int> queue(1);
    std::atomic_bool workerExited{false};

    std::thread worker([&queue, &workerExited]() {
        int value = 0;
        assert(!queue.pop(value));
        workerExited.store(true);
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(10));
    queue.close();
    worker.join();

    assert(workerExited.load());
}

void testPushFailsAfterShutdown() {
    BoundedQueue<int> queue(1);
    queue.close();
    assert(!queue.push(42));
}

int main() {
    testProducerConsumerPreservesItems();
    testBlockedConsumerShutsDownGracefully();
    testPushFailsAfterShutdown();
    return 0;
}
