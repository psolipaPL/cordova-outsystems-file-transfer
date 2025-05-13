package com.outsystems.plugins.filetransfer

import io.ionic.libs.ionfiletransferlib.IONFLTRController
import io.ionic.libs.ionfiletransferlib.model.IONFLTRDownloadOptions
import io.ionic.libs.ionfiletransferlib.model.IONFLTRProgressStatus
import io.ionic.libs.ionfiletransferlib.model.IONFLTRTransferHttpOptions
import io.ionic.libs.ionfiletransferlib.model.IONFLTRTransferResult
import io.ionic.libs.ionfiletransferlib.model.IONFLTRUploadOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaPlugin
import org.apache.cordova.PluginResult
import org.json.JSONArray
import org.json.JSONObject

class OSFileTransferPlugin : CordovaPlugin() {
    companion object {
        private const val PROGRESS_UPDATE_INTERVAL = 100L // 100ms between progress updates
        private const val DEFAULT_TIMEOUT_MS = 60000 // 60 seconds default timeout
    }

    private lateinit var controller: IONFLTRController
    private val ioScope by lazy { CoroutineScope(Dispatchers.IO) }
    private val listeners: MutableList<CallbackContext> = mutableListOf()
    private var lastProgressUpdate = 0L

    override fun pluginInitialize() {
        super.pluginInitialize()
        controller = IONFLTRController(cordova.context)
    }

    override fun onDestroy() {
        super.onDestroy()
        ioScope.cancel()
    }

    override fun execute(
        action: String,
        args: JSONArray,
        callbackContext: CallbackContext
    ): Boolean {
        return when (action) {
            "downloadFile" -> {
                val options = parseDownloadOptions(args)
                if (options == null) {
                    callbackContext.sendError(OSFileTransferErrors.invalidParameters)
                } else {
                    downloadFile(options, callbackContext)
                }
                true
            }
            "uploadFile" -> {
                val options = parseUploadOptions(args)
                if (options == null) {
                    callbackContext.sendError(OSFileTransferErrors.invalidParameters)
                } else {
                    uploadFile(options, callbackContext)
                }
                true
            }
            "addListener" -> {
                listeners.add(callbackContext)
                true
            }
            "removeAllListeners" -> {
                callbackContext.sendPluginResult(PluginResult(PluginResult.Status.OK))
                listeners.forEach { 
                    // send an error to finish the plugin callback for "addListener"
                    it.sendPluginResult(PluginResult(PluginResult.Status.ERROR, "removeAllListeners was called"))
                }
                listeners.clear()
                true
            }
            else -> false
        }
    }

    private fun parseDownloadOptions(args: JSONArray): OSFileTransferDownloadOptions? {
        return try {
            val optionsObject = args.getJSONObject(0)
            val url = optionsObject.optString("url")
            val path = optionsObject.optString("path")
            
            if (url.isBlank() || path.isBlank()) {
                null
            }
            
            OSFileTransferDownloadOptions(
                url = url,
                path = path,
                progress = optionsObject.optBoolean("progress", false),
                httpOptions = parseHttpOptions(optionsObject, "GET")
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun parseUploadOptions(args: JSONArray): OSFileTransferUploadOptions? {
        return try {
            val optionsObject = args.getJSONObject(0)
            val url = optionsObject.optString("url")
            val path = optionsObject.optString("path")
            
            if (url.isBlank() || path.isBlank()) {
                null
            }
            
            OSFileTransferUploadOptions(
                url = url,
                path = path,
                progress = optionsObject.optBoolean("progress", false),
                mimeType = optionsObject.optString("mimeType"),
                fileKey = optionsObject.optString("fileKey", "file"),
                chunkedMode = optionsObject.optBoolean("chunkedMode", false),
                httpOptions = parseHttpOptions(optionsObject, "POST")
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun parseHttpOptions(options: JSONObject, defaultMethod: String): IONFLTRTransferHttpOptions {
        val headers = options.optJSONObject("headers") ?: JSONObject()
        val params = options.optJSONObject("params") ?: JSONObject()
        
        return IONFLTRTransferHttpOptions(
            method = options.optString("method", defaultMethod),
            headers = headers.toMap(),
            params = params.toParamsMap(),
            shouldEncodeUrlParams = options.optBoolean("shouldEncodeUrlParams", true),
            readTimeout = options.optInt("readTimeout", DEFAULT_TIMEOUT_MS),
            connectTimeout = options.optInt("connectTimeout", DEFAULT_TIMEOUT_MS),
            disableRedirects = options.optBoolean("disableRedirects", false)
        )
    }

    private fun JSONObject.toMap(): Map<String, String> {
        val map = mutableMapOf<String, String>()
        keys().asSequence().forEach { key -> 
            map[key] = optString(key, "")
        }
        return map
    }

    private fun JSONObject.toParamsMap(): Map<String, Array<String>> {
        val map = mutableMapOf<String, Array<String>>()
        this.keys().asSequence().forEach { key ->
            when (val value = this.opt(key)) {
                is String -> map[key] = arrayOf(value)
                is JSONArray -> {
                    val values = (0 until value.length())
                        .mapNotNull { value.optString(it, null) }
                        .toTypedArray()
                    if (values.isNotEmpty()) {
                        map[key] = values
                    }
                }
            }
        }
        return map
    }

    private fun downloadFile(options: OSFileTransferDownloadOptions, callbackContext: CallbackContext) {
        val downloadOptions = IONFLTRDownloadOptions(
            url = options.url,
            filePath = options.path,
            httpOptions = options.httpOptions
        )

        controller.downloadFile(downloadOptions)
            .onEach { result ->
                when (result) {
                    is IONFLTRTransferResult.Ongoing -> {
                        if (options.progress) {
                            notifyProgress("download", options.url, result.status)
                        }
                    }
                    is IONFLTRTransferResult.Complete -> {
                        // Send a final progress update with 100% completion
                        if (options.progress) {
                            val contentLength = result.data.totalBytes
                            val finalStatus = IONFLTRProgressStatus(
                                bytes = contentLength,
                                contentLength = contentLength,
                                lengthComputable = true
                            )
                            notifyProgress("download", options.url, finalStatus, forceUpdate = true)
                        }
                        
                        val response = JSONObject().apply {
                            put("path", options.path)
                        }
                        callbackContext.success(response)
                    }
                }
            }
            .catch { error ->
                val errorInfo = error.toOSFileTransferError().copy(
                    source = options.url,
                    target = options.path
                )
                callbackContext.sendError(errorInfo)
            }
            .launchIn(ioScope)
    }

    private fun uploadFile(options: OSFileTransferUploadOptions, callbackContext: CallbackContext) {
        val uploadOptions = IONFLTRUploadOptions(
            url = options.url,
            filePath = options.path,
            chunkedMode = options.chunkedMode,
            mimeType = options.mimeType,
            fileKey = options.fileKey,
            httpOptions = options.httpOptions
        )

        controller.uploadFile(uploadOptions)
            .onEach { result ->
                when (result) {
                    is IONFLTRTransferResult.Ongoing -> {
                        if (options.progress) {
                            notifyProgress("upload", options.url, result.status)
                        }
                    }
                    is IONFLTRTransferResult.Complete -> {
                        // Send a final progress update with 100% completion
                        if (options.progress) {
                            val contentLength = result.data.totalBytes
                            val finalStatus = IONFLTRProgressStatus(
                                bytes = contentLength,
                                contentLength = contentLength,
                                lengthComputable = true
                            )
                            notifyProgress("upload", options.url, finalStatus, forceUpdate = true)
                        }
                        
                        val response = JSONObject().apply {
                            put("bytesSent", result.data.totalBytes)
                            put("responseCode", result.data.responseCode)
                            put("response", result.data.responseBody)
                            
                            val headersObj = JSONObject()
                            result.data.headers?.entries?.forEach { (key, values) ->
                                key?.let { headerKey ->
                                    headersObj.put(headerKey, values.firstOrNull() ?: "")
                                }
                            }
                            put("headers", headersObj)
                        }
                        callbackContext.success(response)
                    }
                }
            }
            .catch { error ->
                val errorInfo = error.toOSFileTransferError().copy(
                    source = options.path,
                    target = options.url
                )
                callbackContext.sendError(errorInfo)
            }
            .launchIn(ioScope)
    }

    /**
     * Notify progress to listeners
     * Throttled to every 100ms to avoid excessive callbacks
     * 
     * @param transferType The type of transfer ("download" or "upload")
     * @param url The URL of the file being transferred
     * @param status The status of the transfer containing bytes, contentLength, etc.
     * @param forceUpdate If true, sends the update regardless of throttling
     */
    private fun notifyProgress(transferType: String, url: String, status: IONFLTRProgressStatus, forceUpdate: Boolean = false) {
        val currentTime = System.currentTimeMillis()
        if (forceUpdate || currentTime - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
            val progressData = JSONObject().apply {
                put("type", transferType)
                put("url", url)
                put("bytes", status.bytes)
                put("contentLength", status.contentLength)
                put("lengthComputable", status.lengthComputable)
            }
            
            listeners.forEach { listener ->
                if (!listener.isFinished) {
                    val pluginResult = PluginResult(PluginResult.Status.OK, progressData)
                    pluginResult.keepCallback = true
                    listener.sendPluginResult(pluginResult)
                }
            }
            
            lastProgressUpdate = currentTime
        }
    }

    /**
     * Extension function to return an unsuccessful plugin result
     * @param error error class representing the error to return, containing a code and message
     */
    private fun CallbackContext.sendError(error: OSFileTransferErrors.ErrorInfo) {
        val errorJson = JSONObject().apply {
            put("code", error.code)
            put("message", error.message)
            if (error.source != null) put("source", error.source)
            if (error.target != null) put("target", error.target)
            if (error.httpStatus != null) put("httpStatus", error.httpStatus)
            if (error.body != null) put("body", error.body)
            
            if (error.headers != null) {
                val headersObj = JSONObject()
                error.headers.entries.forEach { (key, values) ->
                    key?.let { headerKey ->
                        headersObj.put(headerKey, values.firstOrNull() ?: "")
                    }
                }
                put("headers", headersObj)
            }
            
            if (error.exception != null) put("exception", error.exception)
        }
        
        val pluginResult = PluginResult(PluginResult.Status.ERROR, errorJson)
        this.sendPluginResult(pluginResult)
    }
}