class BaseProvider {
    constructor(name, baseUrl, apiKey) {
        this.name = name;
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }

    async discoverModels() {
        throw new Error("discoverModels() must be implemented by subclass");
    }

    async healthCheck() {
        throw new Error("healthCheck() must be implemented by subclass");
    }
}

module.exports = BaseProvider;