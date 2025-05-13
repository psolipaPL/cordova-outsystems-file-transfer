package com.outsystems.plugins.filetransfer

import io.ionic.libs.ionfiletransferlib.model.IONFLTRTransferHttpOptions

data class OSFileTransferDownloadOptions(
    val url: String,
    val path: String,
    val progress: Boolean,
    val httpOptions: IONFLTRTransferHttpOptions
)

data class OSFileTransferUploadOptions(
    val url: String,
    val path: String,
    val progress: Boolean,
    val mimeType: String?,
    val fileKey: String,
    val chunkedMode: Boolean,
    val httpOptions: IONFLTRTransferHttpOptions
) 