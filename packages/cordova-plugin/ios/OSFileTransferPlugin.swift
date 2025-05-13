import Foundation
import Combine
import IONFileTransferLib
import QuartzCore

private enum Action: String {
    case download
    case upload
}

/// A Cordova plugin that enables file upload and download using the IONFileTransferLib.
///
/// This plugin provides two main JavaScript-exposed methods: `uploadFile` and `downloadFile`.
/// Internally, it uses Combine to observe progress and results, and bridges data using CDVCommandDelegate.
@objc(OSFileTransferPlugin)
class OSFileTransferPlugin : CDVPlugin {
    private lazy var manager = IONFLTRManager()
    private var listeners: [CDVInvokedUrlCommand] = []
    private var cancellables = Set<AnyCancellable>()
    private var lastProgressReportTime = CACurrentMediaTime()
    private let progressUpdateInterval: TimeInterval = 0.1 // 100ms
    
    // MARK: - Public API Methods
    
    @objc(downloadFile:)
    func downloadFile(command: CDVInvokedUrlCommand) {
        do {
            let (serverURL, fileURL, shouldTrackProgress, httpOptions) = try validateAndPrepare(command: command, action: .download)
            
            try manager.downloadFile(
                fromServerURL: serverURL,
                toFileURL: fileURL,
                withHttpOptions: httpOptions
            ).sink(
                receiveCompletion: handleCompletion(command: command, source: serverURL.absoluteString, target: fileURL.absoluteString),
                receiveValue: handleReceiveValue(
                    command: command,
                    type: .download,
                    url: serverURL.absoluteString,
                    path: fileURL.path,
                    shouldTrackProgress: shouldTrackProgress
                )
            ).store(in: &cancellables)
        } catch {
            sendError(command, error.toFileTransferError(), 
                      source: getParameter(command, "url") as? String,
                      target: getParameter(command, "path") as? String)
        }
    }
    
    @objc(uploadFile:)
    func uploadFile(command: CDVInvokedUrlCommand) {
        do {
            let (serverURL, fileURL, shouldTrackProgress, httpOptions) = try validateAndPrepare(command: command, action: .upload)
            
            let chunkedMode = getBoolParameter(command, "chunkedMode") ?? false
            let mimeType = getParameter(command, "mimeType") as? String
            let fileKey = getParameter(command, "fileKey") as? String ?? "file"
            
            let uploadOptions = IONFLTRUploadOptions(
                chunkedMode: chunkedMode,
                mimeType: mimeType,
                fileKey: fileKey
            )
            
            try manager.uploadFile(
                fromFileURL: fileURL,
                toServerURL: serverURL,
                withUploadOptions: uploadOptions,
                andHttpOptions: httpOptions
            ).sink(
                receiveCompletion: handleCompletion(command: command, source: fileURL.absoluteString, target: serverURL.absoluteString),
                receiveValue: handleReceiveValue(
                    command: command,
                    type: .upload,
                    url: serverURL.absoluteString,
                    path: fileURL.path,
                    shouldTrackProgress: shouldTrackProgress
                )
            ).store(in: &cancellables)
        } catch {
            sendError(command, error.toFileTransferError(),
                      source: getParameter(command, "path") as? String,
                      target: getParameter(command, "url") as? String)
        }
    }
    
    @objc(addListener:)
    func addListener(command: CDVInvokedUrlCommand) {
        listeners.append(command)
    }
    
    @objc(removeAllListeners:)
    func removeAllListeners(command: CDVInvokedUrlCommand) {
        let result = CDVPluginResult(status: CDVCommandStatus_OK)
        commandDelegate.send(result, callbackId: command.callbackId)
        
        for listener in listeners {
            let result = CDVPluginResult(status: CDVCommandStatus_ERROR, messageAs: "removeAllListeners was called")
            commandDelegate.send(result, callbackId: listener.callbackId)
        }
        
        listeners.removeAll()
    }
    
    // MARK: - Helper Methods
    
    /// Validates parameters from the command and prepares transfer-related data.
    ///
    /// - Parameters:
    ///   - command: The plugin command.
    ///   - action: The type of action (`upload` or `download`).
    /// - Throws: An error if validation fails.
    /// - Returns: Tuple containing server URL, file URL, progress flag, and HTTP options.
    private func validateAndPrepare(command: CDVInvokedUrlCommand, action: Action) throws -> (URL, URL, Bool, IONFLTRHttpOptions) {
        guard let options = command.arguments[0] as? [String: Any] else {
            throw OSFileTransferError.invalidParameters()
        }
        
        guard let urlString = options["url"] as? String, !urlString.isEmpty else {
            throw OSFileTransferError.invalidServerUrl(nil)
        }
        
        guard let serverURL = URL(string: urlString) else {
            throw OSFileTransferError.invalidServerUrl(urlString)
        }
        
        guard let filePath = options["path"] as? String, !filePath.isEmpty else {
            throw OSFileTransferError.invalidParameters("Path is required.")
        }
        
        guard let fileURL = URL(string: filePath) else {
            throw OSFileTransferError.invalidParameters("Path is invalid.")
        }
        
        let shouldTrackProgress = options["progress"] as? Bool ?? false
        
        let httpOptions = createHttpOptions(from: options, defaultMethod: defaultHTTPMethod(for: action))
        
        return (serverURL, fileURL, shouldTrackProgress, httpOptions)
    }
    
    /// Provides the default HTTP method for the given action.
    private func defaultHTTPMethod(for action: Action) -> String {
        switch action {
        case .download:
            return "GET"
        case .upload:
            return "POST"
        }
    }
    
    private func createHttpOptions(from options: [String: Any], defaultMethod: String) -> IONFLTRHttpOptions {
        let method = options["method"] as? String ?? defaultMethod
        let headers = options["headers"] as? [String: String] ?? [:]
        let params = extractParams(from: options["params"] as? [String: Any] ?? [:])
        let timeoutInSeconds = (options["connectTimeout"] as? Int ?? 60000) / 1000  // Convert ms to seconds
        let disableRedirects = options["disableRedirects"] as? Bool ?? false
        let shouldEncodeUrlParams = options["shouldEncodeUrlParams"] as? Bool ?? true
        
        return IONFLTRHttpOptions(
            method: method,
            params: params,
            headers: headers,
            timeout: Int(timeoutInSeconds),
            disableRedirects: disableRedirects,
            shouldEncodeUrlParams: shouldEncodeUrlParams
        )
    }
    
    private func extractParams(from params: [String: Any]) -> [String: [String]] {
        var result: [String: [String]] = [:]
        
        for (key, value) in params {
            if let stringValue = value as? String {
                result[key] = [stringValue]
            } else if let arrayValue = value as? [Any] {
                let stringArray = arrayValue.compactMap { $0 as? String }
                if !stringArray.isEmpty {
                    result[key] = stringArray
                }
            }
        }
        
        return result
    }
    
    /// Handles completion of the upload or download Combine pipeline.
    private func handleCompletion(command: CDVInvokedUrlCommand, source: String, target: String) -> (Subscribers.Completion<Error>) -> Void {
        return { completion in
            if case let .failure(error) = completion {
                self.sendError(command, error.toFileTransferError(), source: source, target: target)
            }
        }
    }
    
    /// Handles received value from the Combine stream.
    ///
    /// - Parameters:
    ///   - command: The original plugin command.
    ///   - type: Whether it's an upload or download.
    ///   - url: The source or destination URL as string.
    ///   - path: The file path used in the transfer.
    ///   - shouldTrackProgress: Whether progress events should be emitted.
    private func handleReceiveValue(
        command: CDVInvokedUrlCommand,
        type: Action,
        url: String,
        path: String,
        shouldTrackProgress: Bool
    ) -> (IONFLTRTransferResult) -> Void {
        return { result in
            switch result {
            case .ongoing(let status):
                self.reportProgressIfNeeded(
                    type: type,
                    url: url,
                    bytes: status.bytes,
                    contentLength: status.contentLength,
                    lengthComputable: status.lengthComputable,
                    shouldTrack: shouldTrackProgress
                )
                
            case .complete(let data):
                self.reportProgressIfNeeded(
                    type: type,
                    url: url,
                    bytes: data.totalBytes,
                    contentLength: data.totalBytes,
                    lengthComputable: true,
                    shouldTrack: shouldTrackProgress,
                    force: true
                )
                
                let resultDict: [String: Any] = {
                    switch type {
                    case .download:
                        return ["path": path]
                    case .upload:
                        return [
                            "bytesSent": data.totalBytes,
                            "responseCode": data.responseCode,
                            "response": data.responseBody ?? "",
                            "headers": data.headers
                        ]
                    }
                }()
                
                self.sendSuccess(command, resultDict)
            }
        }
    }
    
    /**
     * Reports a progress event to JavaScript listeners if conditions are met.
     *
     * This method emits a progress event with details about the transfer status, including
     * the number of bytes transferred and the total expected content length. It respects a
     * throttling interval to avoid sending too many events, unless forced via the `force` parameter.
     *
     * - Parameters:
     *   - type: The type of file transfer operation (`upload` or `download`).
     *   - url: The source or destination URL of the file transfer.
     *   - bytes: The number of bytes transferred so far.
     *   - contentLength: The total number of bytes expected to be transferred.
     *   - lengthComputable: A Boolean value indicating whether the content length is known.
     *   - shouldTrack: A flag indicating whether progress tracking is enabled.
     *   - force: A flag that, if true, bypasses throttling and sends the event immediately. Defaults to `false`.
     */
    private func reportProgressIfNeeded(
        type: Action,
        url: String,
        bytes: Int,
        contentLength: Int,
        lengthComputable: Bool,
        shouldTrack: Bool,
        force: Bool = false
    ) {
        guard shouldTrack else { return }
        
        let current = CACurrentMediaTime()
        guard force || (current - lastProgressReportTime >= progressUpdateInterval) else { return }
        lastProgressReportTime = current
        
        let progressData: [String: Any] = [
            "type": type.rawValue,
            "url": url,
            "bytes": bytes,
            "contentLength": contentLength,
            "lengthComputable": lengthComputable
        ]
        
        for listener in listeners {
            let result = CDVPluginResult(status: CDVCommandStatus_OK, messageAs: progressData)
            result?.keepCallback = true
            commandDelegate.send(result, callbackId: listener.callbackId)
        }
    }
    
    private func sendSuccess(_ command: CDVInvokedUrlCommand, _ result: [String: Any] = [:]) {
        let pluginResult = CDVPluginResult(status: CDVCommandStatus_OK, messageAs: result)
        commandDelegate.send(pluginResult, callbackId: command.callbackId)
    }
    
    private func sendError(_ command: CDVInvokedUrlCommand, _ error: OSFileTransferError, source: String? = nil, target: String? = nil) {
        var errorWithContext = error
        errorWithContext.source = source
        errorWithContext.target = target
        
        let pluginResult = CDVPluginResult(status: CDVCommandStatus_ERROR, messageAs: errorWithContext.toDictionary())
        commandDelegate.send(pluginResult, callbackId: command.callbackId)
    }
    
    // Helper methods for parameter extraction
    
    private func getParameter(_ command: CDVInvokedUrlCommand, _ key: String) -> Any? {
        guard let options = command.arguments[0] as? [String: Any] else {
            return nil
        }
        return options[key]
    }
    
    private func getBoolParameter(_ command: CDVInvokedUrlCommand, _ key: String) -> Bool? {
        return getParameter(command, key) as? Bool
    }
}
