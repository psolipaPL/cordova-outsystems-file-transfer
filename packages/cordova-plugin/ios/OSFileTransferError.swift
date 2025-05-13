import Foundation
import IONFileTransferLib

struct OSFileTransferError: Error {
    /// A  error code in the format `OS-PLUG-FLTR-XXXX`.
    let code: String
    
    /// A human-readable error message.
    let message: String
    
    /// The source URL or path related to the error, if available.
    var source: String?

    /// The target URL or path related to the error, if available.
    var target: String?

    /// The HTTP status code, if the error is related to a network response.
    let httpStatus: Int?

    /// The response body returned by the server, if any.
    let body: String?

    /// The response headers returned by the server, if any.
    let headers: [String: [String]]?
    
    /// The underlying error that caused this error, if any.
    let cause: Error?

    init(
        code: Int,
        message: String,
        source: String? = nil,
        target: String? = nil,
        httpStatus: Int? = nil,
        body: String? = nil,
        headers: [String: [String]]? = nil,
        cause: Error? = nil
    ) {
        self.code = String(format: "OS-PLUG-FLTR-%04d", code)
        self.message = message
        self.source = source
        self.target = target
        self.httpStatus = httpStatus
        self.body = body
        self.headers = headers
        self.cause = cause
    }
    
    func toDictionary() -> [String: Any] {
        var dict: [String: Any] = [
            "code": code,
            "message": message
        ]
        
        if let source = source {
            dict["source"] = source
        }
        
        if let target = target {
            dict["target"] = target
        }
        
        if let httpStatus = httpStatus {
            dict["httpStatus"] = httpStatus
        }
        
        if let body = body {
            dict["body"] = body
        }
        
        if let headers = headers {
            let headersDict = headers.mapValues { $0.first ?? "" }
            dict["headers"] = headersDict
        }
        
        if let cause = cause {
            dict["exception"] = cause.localizedDescription
        }
        
        return dict
    }
}

// MARK: - Static Constructors

extension OSFileTransferError {
    static func invalidParameters(_ message: String? = nil) -> OSFileTransferError {
        .init(code: 4, message: message ?? "The method's input parameters aren't valid.")
    }
    
    static func invalidServerUrl(_ url: String?) -> OSFileTransferError {
        .init(
            code: 5,
            message: (url?.isEmpty ?? true)
                ? "URL to connect to is either null or empty."
                : "Invalid server URL was provided - \(url!)",
            source: url
        )
    }
    
    static func fileDoesNotExist() -> OSFileTransferError {
        .init(code: 7, message: "Operation failed because file does not exist.")
    }

    static func connectionError() -> OSFileTransferError {
        .init(code: 8, message: "Failed to connect to server.")
    }
    
    static func notModified() -> OSFileTransferError {
        .init(
            code: 9,
            message: "The server responded with HTTP 304 – Not Modified. If you want to avoid this, check your headers related to HTTP caching.",
            httpStatus: 304
        )
    }
    
    static func httpError(
        responseCode: Int,
        message: String,
        responseBody: String? = nil,
        headers: [String: [String]]? = nil,
        cause: Error? = nil
    ) -> OSFileTransferError {
        .init(
            code: 10,
            message: "HTTP error: \(responseCode) - \(message)",
            httpStatus: responseCode,
            body: responseBody,
            headers: headers,
            cause: cause
        )
    }
    
    static func genericError(
        message: String = "The operation failed with an error.",
        cause: Error? = nil
    ) -> OSFileTransferError {
        .init(
            code: 11,
            message: message,
            cause: cause
        )
    }
}

// MARK: - IONFLTRException Mapping

extension IONFLTRException {
    func toFileTransferError() -> OSFileTransferError {
        switch self {
        case .invalidPath:
            return OSFileTransferError.invalidParameters()
        case .emptyURL:
            return OSFileTransferError.invalidServerUrl(nil)
        case .invalidURL(let url):
            return OSFileTransferError.invalidServerUrl(url)
        case .fileDoesNotExist:
            return OSFileTransferError.fileDoesNotExist()
        case .cannotCreateDirectory:
            return OSFileTransferError.genericError(cause: self)
        case .httpError(let responseCode, let responseBody, let headers):
            // Convert String:String dictionary to String:[String] format
            let convertedHeaders: [String: [String]]? = headers.map { dict in
                return dict.reduce(into: [String: [String]]()) { result, entry in
                    result[entry.key] = [entry.value]
                }
            }
            
            return responseCode == 304
            ? OSFileTransferError.notModified()
            : OSFileTransferError.httpError(
                responseCode: responseCode,
                message: self.description,
                responseBody: responseBody,
                headers: convertedHeaders,
                cause: self
            )
        case .connectionError:
            return OSFileTransferError.connectionError()
        case .transferError:
            return OSFileTransferError.genericError(cause: self)
        case .unknownError:
            return OSFileTransferError.genericError(cause: self)
        @unknown default:
            return OSFileTransferError.genericError(cause: self)
        }
    }
}

extension Error {
    func toFileTransferError() -> OSFileTransferError {
        if let error = self as? OSFileTransferError {
            return error
        } else if let error = self as? IONFLTRException {
            return error.toFileTransferError()
        } else {
            return OSFileTransferError.genericError(cause: self)
        }
    }
} 