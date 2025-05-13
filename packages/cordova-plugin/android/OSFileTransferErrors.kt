package com.outsystems.plugins.filetransfer

import io.ionic.libs.ionfiletransferlib.model.IONFLTRException

object OSFileTransferErrors {
    fun formatErrorCode(number: Int): String {
        return "OS-PLUG-FLTR-" + number.toString().padStart(4, '0')
    }

    data class ErrorInfo(
        val code: String,
        val message: String,
        val source: String? = null,
        val target: String? = null,
        val httpStatus: Int? = null,
        val body: String? = null,
        val headers: Map<String, List<String>>? = null,
        val exception: String? = null
    )

    val invalidParameters = ErrorInfo(
        code = formatErrorCode(4),
        message = "The method's input parameters aren't valid."
    )

    fun invalidServerUrl(url: String) = if (url.isBlank()) {
        urlEmpty
    } else {
        ErrorInfo(
            code = formatErrorCode(5),
            message = "Invalid server URL was provided - $url",
            source = url
        )
    }

    val permissionDenied = ErrorInfo(
        code = formatErrorCode(6),
        message = "Unable to perform operation, user denied permission request."
    )

    val fileDoesNotExist = ErrorInfo(
        code = formatErrorCode(7),
        message = "Operation failed because file does not exist."
    )

    val connectionError = ErrorInfo(
        code = formatErrorCode(8),
        message = "Failed to connect to server."
    )

    val notModified = ErrorInfo(
        code = formatErrorCode(9),
        message = "The server responded with HTTP 304 – Not Modified. If you want to avoid this, check your headers related to HTTP caching.",
        httpStatus = 304
    )
    
    fun httpError(responseCode: String, message: String, responseBody: String?, headers: Map<String, List<String>>?) = ErrorInfo(
        code = formatErrorCode(10),
        message = "HTTP error: $responseCode - $message",
        httpStatus = responseCode.toIntOrNull(),
        body = responseBody,
        headers = headers,
        exception = message
    )
    
    fun genericError(cause: Throwable) = ErrorInfo(
        code = formatErrorCode(11),
        message = "The operation failed with an error - ${cause.localizedMessage}",
        exception = cause.localizedMessage
    )

    val urlEmpty = ErrorInfo(
        code = formatErrorCode(5),
        message = "URL to connect to is either null or empty."
    )
}

fun Throwable.toOSFileTransferError(): OSFileTransferErrors.ErrorInfo = when (this) {
    is IONFLTRException.InvalidPath -> OSFileTransferErrors.invalidParameters
    is IONFLTRException.EmptyURL -> OSFileTransferErrors.urlEmpty
    is IONFLTRException.InvalidURL -> OSFileTransferErrors.invalidServerUrl(url)
    is IONFLTRException.FileDoesNotExist -> OSFileTransferErrors.fileDoesNotExist
    is IONFLTRException.CannotCreateDirectory -> OSFileTransferErrors.genericError(this)
    is IONFLTRException.HttpError -> {
        if (responseCode == "304") {
            OSFileTransferErrors.notModified
        } else {
            OSFileTransferErrors.httpError(responseCode, message, responseBody, headers)
        }
    }
    is IONFLTRException.ConnectionError -> OSFileTransferErrors.connectionError
    is IONFLTRException.TransferError -> OSFileTransferErrors.genericError(this)
    is IONFLTRException.UnknownError -> OSFileTransferErrors.genericError(this)
    is SecurityException -> OSFileTransferErrors.permissionDenied
    else -> OSFileTransferErrors.genericError(this)
}