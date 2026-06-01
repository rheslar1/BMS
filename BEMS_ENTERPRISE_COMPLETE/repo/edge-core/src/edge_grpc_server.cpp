#include "edge_grpc_server.h"
#include "bacnet_interface.h"
#include "edge_service.grpc.pb.h"
#include <grpcpp/grpcpp.h>
#include <iostream>
#include <memory>
#include <vector>

namespace {

namespace edgepb = bems::edge::v1;

void populateDevice(const DeviceDetails &source, edgepb::Device *target) {
    target->set_id(source.id);
    target->set_zone_id(source.zoneId);
    target->set_bacnet_instance(source.bacnetInstance);
    target->set_object_instance(source.objectInstance);
    target->set_name(source.name);
    target->set_type(source.type);
    target->set_vendor(source.vendor);
    target->set_model(source.model);
    target->set_ip_address(source.ipAddress);
    target->set_object_type(source.objectType);
    target->set_units(source.units);
    target->set_present_value(source.presentValue);
    target->set_status(source.status);
}

WriteMode toRuntimeWriteMode(edgepb::WriteMode mode) {
    return mode == edgepb::WRITE_MODE_DELTA ? WriteMode::Delta : WriteMode::Absolute;
}

class EdgeCoreGrpcService final : public edgepb::EdgeCoreService::Service {
public:
    explicit EdgeCoreGrpcService(EdgeRuntime &runtime) : runtime_(runtime) {}

    grpc::Status Health(grpc::ServerContext *,
                        const edgepb::HealthRequest *,
                        edgepb::HealthResponse *response) override {
        response->set_status("healthy");
        response->set_edge_version("edge-core-grpc-1.0");
        return grpc::Status::OK;
    }

    grpc::Status ListDevices(grpc::ServerContext *,
                             const edgepb::ListDevicesRequest *,
                             edgepb::ListDevicesResponse *response) override {
        for (const auto &device : runtime_.listDevices()) {
            populateDevice(device, response->add_devices());
        }
        return grpc::Status::OK;
    }

    grpc::Status DiscoverDevices(grpc::ServerContext *,
                                 const edgepb::DiscoverDevicesRequest *request,
                                 edgepb::DiscoverDevicesResponse *response) override {
        int low = request->low_instance() > 0 ? request->low_instance() : 1;
        int high = request->high_instance() >= low ? request->high_instance() : low;

        for (const auto &device : runtime_.discoverDevices(low, high)) {
            populateDevice(device, response->add_devices());
        }
        return grpc::Status::OK;
    }

    grpc::Status ReadPoint(grpc::ServerContext *,
                           const edgepb::ReadPointRequest *request,
                           edgepb::ReadPointResponse *response) override {
        double value = 0.0;
        if (!runtime_.readPoint(request->device_instance(), request->object_type(), request->object_instance(), value)) {
            response->set_status("read_failed");
            return grpc::Status(grpc::StatusCode::UNAVAILABLE, "BACnet ReadProperty failed");
        }

        response->set_value(value);
        response->set_units("");
        response->set_status("normal");
        return grpc::Status::OK;
    }

    grpc::Status ReadPoints(grpc::ServerContext *,
                            const edgepb::ReadPointsRequest *request,
                            edgepb::ReadPointsResponse *response) override {
        const int maxRetries = request->max_retries() > 0 ? request->max_retries() : 2;
        response->set_strategy("cov_first_read_property_multiple_fallback_single_read_property");

        std::vector<BacnetReadPropertyRequest> rpmRequests;
        rpmRequests.reserve(static_cast<size_t>(request->points_size()));
        for (const auto &point : request->points()) {
            rpmRequests.push_back({point.device_instance(), point.object_type(), point.object_instance()});
        }

        std::vector<BacnetReadPropertyResult> rpmResults(rpmRequests.size());
        const bool rpmAccepted = !rpmRequests.empty() &&
                                 bacnet_read_properties_multiple(rpmRequests.data(), rpmRequests.size(), rpmResults.data());
        if (rpmAccepted) {
            for (const auto &rpmResult : rpmResults) {
                auto *result = response->add_results();
                result->set_device_instance(rpmResult.deviceInstance);
                result->set_object_type(rpmResult.objectType);
                result->set_object_instance(rpmResult.objectInstance);
                result->set_attempts(1);
                result->set_success(rpmResult.success);
                result->set_value(rpmResult.success ? rpmResult.value : 0.0);
                result->set_units("");
                result->set_status(rpmResult.success ? "normal" : "offline");
                result->set_offline(!rpmResult.success);
                result->set_error(rpmResult.success ? "" : "BACnet ReadPropertyMultiple did not return this point");
            }
            return grpc::Status::OK;
        }

        for (const auto &point : request->points()) {
            auto *result = response->add_results();
            result->set_device_instance(point.device_instance());
            result->set_object_type(point.object_type());
            result->set_object_instance(point.object_instance());

            double value = 0.0;
            bool success = false;
            int attempts = 0;
            for (; attempts <= maxRetries; ++attempts) {
                if (runtime_.readPoint(point.device_instance(), point.object_type(), point.object_instance(), value)) {
                    success = true;
                    break;
                }
            }

            result->set_attempts(attempts + (success ? 1 : 0));
            result->set_success(success);
            result->set_value(success ? value : 0.0);
            result->set_units("");
            result->set_status(success ? "normal" : "offline");
            result->set_offline(!success);
            result->set_error(success ? "" : "BACnet read failed after retry budget");
        }

        return grpc::Status::OK;
    }

    grpc::Status WritePoint(grpc::ServerContext *,
                            const edgepb::WritePointRequest *request,
                            edgepb::WritePointResponse *response) override {
        const auto result = runtime_.writePoint(
            request->device_instance(),
            request->object_type(),
            request->object_instance(),
            request->value(),
            toRuntimeWriteMode(request->mode()));

        response->set_accepted(result.accepted);
        response->set_previous_value(result.previousValue);
        response->set_written_value(result.writtenValue);
        response->set_message(result.message);

        if (!result.accepted) {
            return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION, result.message);
        }
        return grpc::Status::OK;
    }

    grpc::Status SubscribeCov(grpc::ServerContext *,
                              const edgepb::SubscribeCovRequest *request,
                              edgepb::SubscribeCovResponse *response) override {
        const bool accepted = bacnet_subscribe_cov(
            request->device_instance(),
            request->object_type(),
            request->object_instance(),
            request->subscriber_process_id(),
            request->lifetime_seconds(),
            request->confirmed_notifications());

        response->set_accepted(accepted);
        response->set_status(accepted ? "subscribed" : "subscribe_failed");
        response->set_message(accepted ? "BACnet SubscribeCOV accepted" : "BACnet SubscribeCOV failed");

        if (!accepted) {
            return grpc::Status(grpc::StatusCode::UNAVAILABLE, "BACnet SubscribeCOV failed");
        }
        return grpc::Status::OK;
    }

    grpc::Status GetEnergyForecast(grpc::ServerContext *,
                                   const edgepb::EnergyForecastRequest *request,
                                   edgepb::EnergyForecastResponse *response) override {
        int hours = request->hours() > 0 ? request->hours() : 3;
        for (const auto &entry : runtime_.getEnergyForecast(hours)) {
            auto *prediction = response->add_forecast();
            prediction->set_interval(entry.interval);
            prediction->set_predicted_kwh(entry.predictedKwh);
            prediction->set_estimated_cost(entry.estimatedCost);
            prediction->set_recommendation(entry.recommendation);
        }
        return grpc::Status::OK;
    }

private:
    EdgeRuntime &runtime_;
};

} // namespace

void runEdgeGrpcServer(EdgeRuntime &runtime, const std::string &serverAddress) {
    EdgeCoreGrpcService service(runtime);
    grpc::ServerBuilder builder;
    builder.AddListeningPort(serverAddress, grpc::InsecureServerCredentials());
    builder.RegisterService(&service);

    std::unique_ptr<grpc::Server> server(builder.BuildAndStart());
    if (!server) {
        std::cerr << "Failed to start EdgeCoreService gRPC server on " << serverAddress << std::endl;
        return;
    }

    std::cout << "EdgeCoreService gRPC server listening on " << serverAddress << std::endl;
    server->Wait();
}
