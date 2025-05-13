import { DownloadFileResult, FileTransferError, ProgressStatus, UploadFileResult } from "../../cordova-plugin/src/definitions";
import * as OSFileTransferLibJS from "./pwa";

// Import the FilePlugin
declare const OSFilePluginWrapper: { Instance: any };

class OSFileTransferWrapper {
    private listenersCount = 0;

    downloadFile(options: any, scope: any): void {
        let fileName = options.path.split('/').pop();

        if (this.isPWA()) {
            OSFileTransferLibJS.downloadWithHeaders(options.url, options.headers, fileName);
            return;
        }

        if (!scope) {
            return;
        }
        
        this.listenersCount++;
        
        const downloadSuccess = (res: DownloadFileResult) => {
            if (this.isFilePluginAvailable() && res.path) {
                const statSuccess = (fileInfo: any) => {
                    this.handleBasicFileInfo(scope, res.path, fileInfo.name);
                };

                OSFilePluginWrapper.Instance.stat(
                    statSuccess, 
                    () => this.handleBasicFileInfo(scope, res.path), 
                    { path: res.path }
                );
            } else {
                this.handleBasicFileInfo(scope, res.path);
            }
        };
        
        const downloadError = (err: FileTransferError) => {
            if (scope.downloadCallback && scope.downloadCallback.downloadError) {
                scope.downloadCallback.downloadError(err);
            }
            this.handleTransferFinished();
        };
        
        const progressCallback = (progress: ProgressStatus) => {
            if (scope.downloadCallback && scope.downloadCallback.downloadProgress) {
                const progressEvent = {
                    loaded: progress.bytes,
                    total: progress.contentLength,
                    lengthComputable: progress.lengthComputable
                };
                scope.downloadCallback.downloadProgress(progressEvent);
            }
        };
        
        if (this.isSynapseDefined()) {
            // @ts-ignore - For MABS with Synapse
            CapacitorUtils.Synapse.FileTransfer.addListener('progress', progressCallback);
            // @ts-ignore
            CapacitorUtils.Synapse.FileTransfer.downloadFile(options, downloadSuccess, downloadError);
        } else if (this.isCapacitorPluginDefined()) {
            // @ts-ignore - For Capacitor without Synapse (e.g., MABS 12)
            Capacitor.Plugins.FileTransfer.addListener('progress', progressCallback);
            // @ts-ignore
            Capacitor.Plugins.FileTransfer.downloadFile(options)
                .then(downloadSuccess)
                .catch(downloadError);
        }
    }
    
    /**
     * Creates a file result object and notifies the download callback with the result.
     */
    private handleBasicFileInfo(scope: any, filePath?: string, fileName?: string): void {
        const fileResult = {
            path: filePath,
            name: fileName || filePath?.split('/').pop() || '',
            isFile: true,
            isDirectory: false,
            fullPath: filePath,
            nativeURL: filePath ? `file://${filePath}` : undefined
        };
        
        if (scope.downloadCallback && scope.downloadCallback.downloadComplete) {
            scope.downloadCallback.downloadComplete(fileResult);
        }
        this.handleTransferFinished();
    }
    
    uploadFile(options: any, scope: any): void {
        if (this.isPWA()) {
            // For PWA, manually retrieve the file and use the web implementation
            fetch(options.url)
                .then(response => response.blob())
                .then(blob => {
                    const file = new File([blob], options.path.split('/').pop() || 'file', { type: options.mimeType || 'application/octet-stream' });
                    OSFileTransferLibJS.uploadWithHeaders(options.url, options.headers, file, options.fileKey || 'file');
                });
            
            return;
        }
        
        if (!scope) {
            return;
        }
        
        this.listenersCount++;
        const uploadSuccess = (res: UploadFileResult) => {
            if (scope.uploadCallback && scope.uploadCallback.uploadComplete) {
                scope.uploadCallback.uploadComplete(res);
            }
            this.handleTransferFinished();
        };
        
        const uploadError = (err: FileTransferError) => {
            if (scope.uploadCallback && scope.uploadCallback.uploadError) {
                scope.uploadCallback.uploadError(err);
            }
            this.handleTransferFinished();
        };
        
        const progressCallback = (progress: ProgressStatus) => {
            if (scope.uploadCallback && scope.uploadCallback.uploadProgress) {
                const progressEvent = {
                    loaded: progress.bytes,
                    total: progress.contentLength,
                    lengthComputable: progress.lengthComputable
                };
                scope.uploadCallback.uploadProgress(progressEvent);
            }
        };
        
        if (this.isSynapseDefined()) {
            // @ts-ignore - For MABS with Synapse
            CapacitorUtils.Synapse.FileTransfer.addListener('progress', progressCallback);
            // @ts-ignore
            CapacitorUtils.Synapse.FileTransfer.uploadFile(options, uploadSuccess, uploadError);
        } else if (this.isCapacitorPluginDefined()) {
            // @ts-ignore - For Capacitor without Synapse (e.g., MABS 12)
            Capacitor.Plugins.FileTransfer.addListener('progress', progressCallback);
            // @ts-ignore
            Capacitor.Plugins.FileTransfer.uploadFile(options)
                .then(uploadSuccess)
                .catch(uploadError);
        }
    }
    
    private handleTransferFinished(): void {
        this.listenersCount--;
        
        if (this.listenersCount < 0) {
            this.listenersCount = 0;
        }
        else if (this.listenersCount === 0) {
            if (this.isSynapseDefined()) {
                // @ts-ignore
                CapacitorUtils.Synapse.FileTransfer.removeAllListeners();
            } else if (this.isCapacitorPluginDefined()) {
                // @ts-ignore
                Capacitor.Plugins.FileTransfer.removeAllListeners();
            }
        }
    }
    
    private isPWA(): boolean {
        if (this.isSynapseDefined()) {
            // Synapse defined <-> native mobile app <-> should use cordova web implementation
            return false;
        }
        if (this.isCapacitorPluginDefined()) {
            // Capacitor plugin defined, so it means we have:
            // - a native mobile app where capacitor plugin comes without Synapse (MABS 12 issue) -> use capacitor plugin
            return false;
        }
        return true;
    }
    
    private isCapacitorPluginDefined(): boolean {
        // @ts-ignore
        return (typeof(Capacitor) !== "undefined" && typeof(Capacitor.Plugins) !== "undefined" && typeof(Capacitor.Plugins.FileTransfer) !== "undefined");
    }

    /**
     * Check that is required because MABS 12 isnt installing synapse dependency for capacitor plugins.
     * Once MABS 12 no longer has that limitation, this can be removed.
     * @returns true if synapse is defined, false otherwise
     */
    private isSynapseDefined(): boolean {
        // @ts-ignore
        return typeof(CapacitorUtils) !== "undefined" && typeof(CapacitorUtils.Synapse) !== "undefined" && typeof(CapacitorUtils.Synapse.FileTransfer) !== "undefined";
    }

    /**
     * Checks if the OSFilePluginWrapper is available
     * @returns true if the File Plugin is defined, false otherwise
     */
    private isFilePluginAvailable(): boolean {
        return typeof OSFilePluginWrapper !== 'undefined' && 
               typeof OSFilePluginWrapper.Instance !== 'undefined' &&
               typeof OSFilePluginWrapper.Instance.stat === 'function';
    }
}

export const Instance = new OSFileTransferWrapper();