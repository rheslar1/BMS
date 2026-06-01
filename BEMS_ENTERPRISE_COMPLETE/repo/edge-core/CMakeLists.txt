cmake_minimum_required(VERSION 3.16)
project(edge_core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Protobuf REQUIRED)
find_package(PkgConfig REQUIRED)
find_package(Threads REQUIRED)
pkg_check_modules(GRPCPP REQUIRED grpc++)
find_program(GRPC_CPP_PLUGIN grpc_cpp_plugin REQUIRED)

set(PROTO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../proto")
set(GENERATED_PROTO_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
set(EDGE_PROTO "${PROTO_DIR}/edge_service.proto")
set(EDGE_PROTO_SRCS
  "${GENERATED_PROTO_DIR}/edge_service.pb.cc"
  "${GENERATED_PROTO_DIR}/edge_service.grpc.pb.cc"
)
set(EDGE_PROTO_HDRS
  "${GENERATED_PROTO_DIR}/edge_service.pb.h"
  "${GENERATED_PROTO_DIR}/edge_service.grpc.pb.h"
)

add_custom_command(
  OUTPUT ${EDGE_PROTO_SRCS} ${EDGE_PROTO_HDRS}
  COMMAND ${CMAKE_COMMAND} -E make_directory "${GENERATED_PROTO_DIR}"
  COMMAND ${Protobuf_PROTOC_EXECUTABLE}
          --proto_path=${PROTO_DIR}
          --cpp_out=${GENERATED_PROTO_DIR}
          --grpc_out=${GENERATED_PROTO_DIR}
          --plugin=protoc-gen-grpc=${GRPC_CPP_PLUGIN}
          ${EDGE_PROTO}
  DEPENDS "${EDGE_PROTO}"
  VERBATIM
)

add_executable(edge-core
  src/main.cpp
  src/bacnet_client.cpp
  src/device_manager.cpp
  src/discovery_service.cpp
  src/edge_runtime.cpp
  src/edge_grpc_server.cpp
  src/energy_ai.cpp
  src/bacnet_interface.cpp
  src/modbus_rtu_interface.cpp
  src/canbus_interface.cpp
  src/fieldbus_gateway.cpp
  src/writeback_controller.cpp
  src/hvac_control.cpp
  ${EDGE_PROTO_SRCS}
)

target_include_directories(edge-core PRIVATE
  src
  "${GENERATED_PROTO_DIR}"
  ${GRPCPP_INCLUDE_DIRS}
)

target_link_libraries(edge-core PRIVATE
  protobuf::libprotobuf
  ${GRPCPP_LIBRARIES}
  Threads::Threads
)

target_link_directories(edge-core PRIVATE ${GRPCPP_LIBRARY_DIRS})
target_compile_options(edge-core PRIVATE ${GRPCPP_CFLAGS_OTHER})

enable_testing()

add_executable(edge-core-tests
  tests/writeback_controller_test.cpp
  src/writeback_controller.cpp
)

target_include_directories(edge-core-tests PRIVATE src)

add_test(NAME edge-core-tests COMMAND edge-core-tests)

add_executable(edge-core-bacnet-simulator-tests
  tests/bacnet_simulator_test.cpp
  src/bacnet_interface.cpp
)

target_include_directories(edge-core-bacnet-simulator-tests PRIVATE src)

add_test(NAME edge-core-bacnet-simulator-tests COMMAND edge-core-bacnet-simulator-tests)

add_executable(edge-core-fieldbus-tests
  tests/fieldbus_interface_test.cpp
  src/modbus_rtu_interface.cpp
  src/canbus_interface.cpp
  src/fieldbus_gateway.cpp
)

target_include_directories(edge-core-fieldbus-tests PRIVATE src)

add_test(NAME edge-core-fieldbus-tests COMMAND edge-core-fieldbus-tests)

add_executable(edge-core-energy-ai-tests
  tests/energy_ai_test.cpp
  src/energy_ai.cpp
)

target_include_directories(edge-core-energy-ai-tests PRIVATE src)

add_test(NAME edge-core-energy-ai-tests COMMAND edge-core-energy-ai-tests)

add_executable(edge-core-discovery-tests
  tests/discovery_service_test.cpp
  src/discovery_service.cpp
)

target_include_directories(edge-core-discovery-tests PRIVATE src)

add_test(NAME edge-core-discovery-tests COMMAND edge-core-discovery-tests)

add_executable(edge-core-hvac-control-tests
  tests/hvac_control_test.cpp
  src/hvac_control.cpp
)

target_include_directories(edge-core-hvac-control-tests PRIVATE src)

add_test(NAME edge-core-hvac-control-tests COMMAND edge-core-hvac-control-tests)
