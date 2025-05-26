// Type definitions
interface FileTransferErrorObject {
    code: string;
    message: string;
    source?: string;
    target?: string;
    http_status?: number;
    body?: string;
    exception?: string;
}

interface ProgressEvent {
    total: number;
    loaded: number;
    lengthComputable: boolean;
}

interface Header {
    name: string;
    value: string;
}

class FileTransferErrorClass {
    private code: number;
    private message: string;

    constructor(code: number, message: string) {
        this.message = message;
        this.code = code;
    }

    getErrorCode(): string {
        return `OS-PLUG-FLTR-${this.code.toString().padStart(4, '0')}`;
    }

    getMessage(): string {
        return this.message;
    }

    toString(): string {
        return `Error.${this.getErrorCode()}`;
    }
}

// Static instances of error types
const FileTransferError = {
    UPLOAD: new FileTransferErrorClass(10, "HTTP error when uploading."),
    DOWNLOAD: new FileTransferErrorClass(10, "HTTP error when downloading."),
    INVALID_URL: new FileTransferErrorClass(5, "URL to connect to is either null or empty."),
    CONNECTION_ERR: new FileTransferErrorClass(8, "Failed to connect to server."),
    GENERIC_ERR: new FileTransferErrorClass(11, "The operation failed with an error.")
};

/** EVENTS */

/**
 * Function called when a XMLHttpRequest results in an error
 * Dispatches a window event with an error code and data regarding the error
 * Or if the original request was built badly (e.g., invalid url)
 * @param {FileTransferErrorClass} error Error enum related to the error 
 * @param {XMLHttpRequest} request [optional] the request that result in error 
 * @param {String} source what dispulted the error (e.g., upload url or file to be uploaded)
 * @param {String} target the target of the action
 */
async function onError(error: FileTransferErrorClass, request?: XMLHttpRequest, source?: string, target?: string): Promise<void> {
    let body = "";
    if(request) {
        if(request.responseType == "text" || request.responseType == "" ) {
            body = request.responseText;
        } else if (request.responseType == "blob" && request.response) {
            body = await (request.response as Blob).text();
        }
    } 

    // For HTTP errors, use the status code in the message
    let message = error.getMessage();
    if (request && request.status >= 400 && (error === FileTransferError.UPLOAD || error === FileTransferError.DOWNLOAD)) {
        message = `HTTP error: ${request.status} - ${request.statusText || 'Unknown error'}`;
    }

    let requestError: FileTransferErrorObject = {
        code: error.getErrorCode(),
        message: message,
        source: source,
        target: target,
        http_status: request?.status || 0,
        body: body,
        exception: error.getMessage()
    };
    const onErrorEvent = new CustomEvent('fileTransferError', { detail: { error: requestError }});
    window.dispatchEvent(onErrorEvent);
}

/**
 * Function called periodically when the download request receives more data.
 * Dispatches a window event with the amount that was donwloaded, the total to be downloaded and if this total is computable
 * @param {ProgressEvent} e, download onprogress event
 */
function onDownloadProgress(e: ProgressEvent): void {
    let progress = { total: e.total, loaded: e.loaded, lengthComputable: e.lengthComputable};
    const downloadProgress = new CustomEvent('downloadprogress', {detail: { progress: progress}});
    window.dispatchEvent(downloadProgress);
}

/**
 * Function that is called when the download is complete
 * Dispatches a window event with information about the download
 * It also downlaods the file
 * @param {XMLHttpRequest} request, download request 
 * @param {String} fileName, name of the file. If not present and Content-Disposition is not set
 * it will default to image.png
 */
function onDownloadComplete(request: XMLHttpRequest, fileName?: string): void {
    if(request.readyState !== 4)
        return;
    
    // Check for successful status code range (200-299)
    if(request.status < 200 || request.status >= 300) {
        onError(FileTransferError.DOWNLOAD, request, request.responseURL, fileName || "");
        return;
    }    
    
    let mimeType = request.getResponseHeader('Content-Type');

    let content = request.getResponseHeader('Content-Disposition');
    if (content && content.indexOf('attachment') !== -1) {
        let regex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
        let matches = regex.exec(content);

        if (matches != null && matches[1]) { 
            fileName = matches[1].replace(/['"]/g, '');
        }
    }
    
    const downloadComplete = new CustomEvent('downloadcomplete', { detail: { result: { isFile: true, name: fileName}}});
    window.dispatchEvent(downloadComplete);

    let blob = new Blob([request.response], {type: mimeType || 'application/octet-stream'});
    let a = document.createElement('a');
    a.style.display = "none";
    document.body.appendChild(a);
    let url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = fileName || 'download';
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

/**
 * Function that is called when the upload request is completed
 * Dispatches a window event with the information about the File and Response
 * @param {XMLHttpRequest} request, upload request
 * @param {File} file , file that was uploaded
 */
function onUploadComplete(request: XMLHttpRequest, file: File): void {
    if(request.readyState !== 4)
        return;
    
    // Check for successful status code range (200-299)
    if(request.status < 200 || request.status >= 300) {
        onError(FileTransferError.UPLOAD, request, request.responseURL, file.name);
        return;
    }    
    let upResult = {
        name: file.name, 
        bytesSent: file.size, 
        responseCode: request.status
    };
    const uploadComplete = new CustomEvent('uploadcomplete', { detail: { result: upResult}});
    
    window.dispatchEvent(uploadComplete);
}

/**
 * Function called periodically when the upload sends more data.
 * Dispatches a window event with the amount that was sent, the total to be sent and if this total is computable
 * @param {ProgressEvent} e, upload onprogress event
 */
function onUploadProgress(e: ProgressEvent): void {
    let progress = { total: e.total, loaded: e.loaded, lengthComputable: e.lengthComputable};
    const uploadProgress = new CustomEvent('uploadprogress', {detail: { progress: progress }});
    window.dispatchEvent(uploadProgress);
}

/** PUBLIC LIBRARY FUNCTIONS */

/**
 * Uses XMLHttpRequest to download a file from a given endpoint
 * It creates and dispatches events to keep track of the progress, upload complete/end and error events
 * progress event to listen to: downloadprogress
 * error event to listen to: fileTransferError
 * complete event to listen to: donwloadcomplete
 * @param {String} url of the file to be downloaded
 * @param {String} fileName [Optional] name of the file to be downloaded (extension included)
 */
export function download(url: string, fileName?: string): void {
    downloadWithHeaders(url, [], fileName);
}

/**
 * Uses XMLHttpRequest to download a file from a given endpoint, with specific headers
 * It creates and dispatches events to keep track of the progress, upload complete/end and error events
 * progress event to listen to: downloadprogress
 * error event to listen to: fileTransferError
 * complete event to listen to: donwloadcomplete
 * @param {String} url of the file to be downloaded
 * @param {Array<{String, String}>} headers array of the headers to be added to the request
 * @param {String} fileName [Optional] Name of the file to be downloaded (extension included)
 */
export function downloadWithHeaders(url: string, headers: Header[], fileName?: string): void {
    if(url == "") {
        onError(FileTransferError.INVALID_URL, undefined, fileName, url);
        return;
    }    

    let request = new XMLHttpRequest();
    request.responseType = 'blob';

    request.onload = (_e) => {
        onDownloadComplete(request, fileName);
    };

    request.onprogress = onDownloadProgress;

    request.onerror = (_e) => {
        onError(FileTransferError.CONNECTION_ERR, request, fileName, url);
    };
    request.open('GET', url);

    if(headers.length > 0) {
        headers.forEach(h => {
            request.setRequestHeader(h.name, h.value);   
        });
    } 
    request.send();
}

/**
 * Uses XMLHttpRequest to upload a file to given endpoint
 * It creates and dispatches events to keep track of the progress, upload complete/end and error events
 * progress event to listen to: uploadprogress
 * error event to listen to: fileTransferError
 * complete event to listen to: uploadcomplete
 * @param {String} url, endpoint where the file will be uploaded to
 * @param {File} content, the file to be uploaded 
 * @param {String} fileKey, type of form element. The default is set to "file".
 */
export function upload(url: string, content: File, fileKey?: string): void {
    uploadWithHeaders(url, [], content, fileKey);
}

/**
 * Uses XMLHttpRequest to upload a file to given endpoint, with specific headers
 * It creates and dispatches events to keep track of the progress, upload complete/end and error events
 * progress event to listen to: uploadprogress
 * error event to listen to: fileTransferError
 * complete event to listen to: uploadcomplete
 * @param {String} url, endpoint where the file will be uploaded to
 * @param {Array<{String, String}>} headers, headers to be added to the request
 * @param {File} content, the file to be uploaded 
 * @param {String} fileKey, type of form element. The default is set to "file".
 */
export function uploadWithHeaders(url: string, headers: Header[], content: File, fileKey: string = "file"): void {
    if(url == "") {
        onError(FileTransferError.INVALID_URL, undefined, content.name, url);
        return;
    }

    let request = new XMLHttpRequest();
    let data: FormData;

    request.upload.onprogress = onUploadProgress;

    request.onload = (_e) => {
        onUploadComplete(request, content);
    };

    request.upload.onerror = (_e) => {
        onError(FileTransferError.CONNECTION_ERR, request, content.name, url);
    };

    request.open('POST', url);
    if(headers.length > 0) {
        headers.forEach(h => {
            request.setRequestHeader(h.name, h.value);   
        });
    } 
    
    data = new FormData();
    data.append(fileKey, content);
    
    request.send(data);
}

export { FileTransferError };