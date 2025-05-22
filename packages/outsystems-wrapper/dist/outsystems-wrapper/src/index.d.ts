declare class OSFileTransferWrapper {
    private listenersCount;
    downloadFile(options: any, scope: any): void;
    /**
     * Creates a file result object and notifies the download callback with the result.
     */
    private handleBasicFileInfo;
    uploadFile(options: any, scope: any): void;
    private handleTransferFinished;
    /**
     * Converts the error with the correct properties that OutSystems expects in FileTransferError structure.
     * This is done here to have the same fields as the old cordova plugin - thus ensuring backwards compatibility.
     * @param error the error coming from the plugin
     * @returns The error with the properties that OutSystems expects
     */
    private convertError;
    private isPWA;
    private isCapacitorPluginDefined;
    /**
     * Check that is required because MABS 12 isnt installing synapse dependency for capacitor plugins.
     * Once MABS 12 no longer has that limitation, this can be removed.
     * @returns true if synapse is defined, false otherwise
     */
    private isSynapseDefined;
    /**
     * Checks if the OSFilePluginWrapper is available
     * @returns true if the File Plugin is defined, false otherwise
     */
    private isFilePluginAvailable;
}
export declare const Instance: OSFileTransferWrapper;
export {};
