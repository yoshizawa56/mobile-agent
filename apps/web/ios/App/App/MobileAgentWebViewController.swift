import Capacitor

final class MobileAgentWebViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()

        guard let scheme = buildSetting("MOBILE_AGENT_WEB_SCHEME"),
              let host = buildSetting("MOBILE_AGENT_WEB_HOST"),
              let port = buildSetting("MOBILE_AGENT_WEB_PORT"),
              let url = MobileAgentWebURL(scheme: scheme, host: host, port: port) else {
            return descriptor
        }

        descriptor.serverURL = url.value.absoluteString
        descriptor.allowedNavigationHostnames = [url.value.host ?? ""]
        return descriptor
    }

    private func buildSetting(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return value
    }
}

private struct MobileAgentWebURL {
    let value: URL

    init?(scheme rawScheme: String, host rawHost: String, port rawPort: String) {
        let scheme = rawScheme.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let host = rawHost.trimmingCharacters(in: .whitespacesAndNewlines)
        let port = rawPort.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !scheme.isEmpty,
              scheme == "http" || scheme == "https",
              !host.isEmpty,
              !host.contains("/") else {
            return nil
        }

        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        if !port.isEmpty {
            guard let portNumber = Int(port), (1...65_535).contains(portNumber) else {
                return nil
            }
            components.port = portNumber
        }

        guard let url = components.url else {
            return nil
        }
        self.value = url
    }
}
