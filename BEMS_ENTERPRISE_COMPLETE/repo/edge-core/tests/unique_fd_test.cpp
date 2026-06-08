#include "unique_fd.h"

#include <array>
#include <cassert>
#include <cerrno>
#include <fcntl.h>
#include <unistd.h>

bool descriptorOpen(int fd) {
    errno = 0;
    const int result = fcntl(fd, F_GETFD);
    return result != -1;
}

std::array<int, 2> openPipe() {
    std::array<int, 2> fds{};
    assert(pipe(fds.data()) == 0);
    return fds;
}

void testMoveConstructionTransfersOwnership() {
    const auto fds = openPipe();
    UniqueFd reader(fds[0]);
    UniqueFd writer(fds[1]);
    const int readerFd = reader.get();

    UniqueFd moved(std::move(reader));

    assert(!reader);
    assert(reader.get() == -1);
    assert(moved.get() == readerFd);
    assert(descriptorOpen(readerFd));

    const char out = 'x';
    char in = '\0';
    assert(write(writer.get(), &out, 1) == 1);
    assert(read(moved.get(), &in, 1) == 1);
    assert(in == out);
}

void testMoveAssignmentClosesExistingAndTransfersOwnership() {
    const auto oldPipe = openPipe();
    const auto newPipe = openPipe();

    UniqueFd destination(oldPipe[0]);
    UniqueFd oldWriter(oldPipe[1]);
    UniqueFd source(newPipe[0]);
    UniqueFd newWriter(newPipe[1]);

    const int oldDestinationFd = destination.get();
    const int newDestinationFd = source.get();

    destination = std::move(source);

    assert(!source);
    assert(source.get() == -1);
    assert(destination.get() == newDestinationFd);
    assert(!descriptorOpen(oldDestinationFd));
    assert(descriptorOpen(newDestinationFd));

    const char out = 'y';
    char in = '\0';
    assert(write(newWriter.get(), &out, 1) == 1);
    assert(read(destination.get(), &in, 1) == 1);
    assert(in == out);
}

void testMoveAssignmentFromEmptyClosesDestination() {
    const auto fds = openPipe();
    UniqueFd destination(fds[0]);
    UniqueFd writer(fds[1]);
    UniqueFd empty;
    const int destinationFd = destination.get();

    destination = std::move(empty);

    assert(!empty);
    assert(!destination);
    assert(destination.get() == -1);
    assert(!descriptorOpen(destinationFd));
}

void testMovedFromWrapperCanBeReset() {
    const auto first = openPipe();
    UniqueFd source(first[0]);
    UniqueFd firstWriter(first[1]);

    UniqueFd destination(std::move(source));
    assert(!source);

    const auto second = openPipe();
    const int secondFd = second[0];
    UniqueFd secondWriter(second[1]);
    source.reset(secondFd);

    assert(source);
    assert(source.get() == secondFd);
    assert(descriptorOpen(secondFd));
}

int main() {
    testMoveConstructionTransfersOwnership();
    testMoveAssignmentClosesExistingAndTransfersOwnership();
    testMoveAssignmentFromEmptyClosesDestination();
    testMovedFromWrapperCanBeReset();
    return 0;
}
