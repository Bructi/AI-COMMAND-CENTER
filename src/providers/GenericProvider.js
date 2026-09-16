const axios = require('axios');
const BaseProvider = require('./BaseProvider');
const db = require('../db/database.js');

class GenericProvider extends BaseProvider {
    constructor(id, name, baseUrl, apiKey) {
        super(name, baseUrl, apiKey);
        this.id = id;
    }

    _getHeaders() {
        const headers = {
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'AI Command Center'
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }

    async testConnection() {
        const startTime = Date.now();
        try {
            const url = this.baseUrl.endsWith('/models') ? this.baseUrl : `${this.baseUrl}/models`;
            const response = await axios.get(url, {
                headers: this._getHeaders(),
                timeout: 8000
            });
            const latency = Date.now() - startTime;
            const modelCount = response.data?.data?.length || (Array.isArray(response.data) ? response.data.length : 0);
            return { success: true, latency, modelCount, message: `Connected successfully (${modelCount} models detected)` };
        } catch (error) {
            const latency = Date.now() - startTime;
            const errorMsg = error.response ? `HTTP ${error.response.status}: ${error.response.statusText || JSON.stringify(error.response.data)}` : error.message;
            return { success: false, latency, error: errorMsg };
        }
    }

    async discoverModels() {
        try {
            // Some providers need /v1/models, some have it in baseUrl
            const url = this.baseUrl.endsWith('/models') ? this.baseUrl : `${this.baseUrl}/models`;
            const response = await axios.get(url, {
                headers: this._getHeaders(),
                timeout: 20000
            });
            
            const models = response.data?.data || (Array.isArray(response.data) ? response.data : []);
            
            for (const model of models) {
                const modelId = model.id || model.name;
                if (!modelId) continue;

                // Smart Free Model Detection
                let isFree = false;
                if (model.pricing) {
                    isFree = (model.pricing.prompt === "0" || model.pricing.prompt === 0) &&
                             (model.pricing.completion === "0" || model.pricing.completion === 0);
                }
                if (!isFree && (modelId.toLowerCase().includes(':free') || modelId.toLowerCase().includes('-free') || modelId.toLowerCase().includes('/free'))) {
                    isFree = true;
                }
                
                const contextLength = model.context_length || model.max_position_embeddings || model.context_window || 0;
                
                // Assign intelligent roles based on model ID & capabilities
                const roles = [];
                const mid = modelId.toLowerCase();
                if (mid.includes('vision') || mid.includes('vl') || mid.includes('4o') || mid.includes('gemini') || mid.includes('pixtral')) roles.push('VISION');
                if (mid.includes('coder') || mid.includes('code') || mid.includes('deepseek') || mid.includes('starcoder') || mid.includes('dev')) roles.push('CODING');
                if (mid.includes('math') || mid.includes('reason') || mid.includes('r1') || mid.includes('o1') || mid.includes('o3') || mid.includes('qwq') || mid.includes('thought')) roles.push('REASONING');
                if (mid.includes('flash') || mid.includes('mini') || mid.includes('turbo') || mid.includes('speed') || mid.includes('fast') || mid.includes('8b') || mid.includes('3b') || mid.includes('1b')) roles.push('FAST');
                if (mid.includes('agent') || mid.includes('hermes') || mid.includes('tool') || mid.includes('func')) roles.push('AGENT');
                if (roles.length === 0) roles.push('GENERAL');
                
                const rolesStr = roles.join(',');
                
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO models (id, provider_id, is_free, context_length, roles) 
                         VALUES (?, ?, ?, ?, ?) 
                         ON CONFLICT(id) DO UPDATE SET is_free = ?, context_length = ?, roles = ?`,
                        [modelId, this.id, isFree ? 1 : 0, contextLength, rolesStr, isFree ? 1 : 0, contextLength, rolesStr],
                        (err) => err ? reject(err) : resolve()
                    );
                });
            }
            
            return { success: true, count: models.length };
        } catch (error) {
            console.error(`[${this.name}] Discovery failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async healthCheck(modelId) {
        const startTime = Date.now();
        const url = this.baseUrl.endsWith('/chat/completions') ? this.baseUrl : `${this.baseUrl}/chat/completions`;
        
        try {
            // Standard health check probe
            const payload = {
                model: modelId,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 5
            };

            const response = await axios.post(url, payload, {
                headers: this._getHeaders(),
                timeout: 12000
            });

            const latency = Date.now() - startTime;
            const status = '🟢 HEALTHY';
            
            db.run(`UPDATE models SET status = ?, latency = ?, last_tested = CURRENT_TIMESTAMP, score = score + 2 WHERE id = ?`, 
                [status, latency, modelId]);
                
            return { status, latency, success: true, modelId };

        } catch (error) {
            // If error was due to max_tokens (e.g. o1/o3 reasoning models requiring max_completion_tokens), retry with alternative payload
            const errorData = error.response?.data;
            const errorMsgStr = typeof errorData === 'object' ? JSON.stringify(errorData) : String(errorData || error.message);
            
            if (errorMsgStr.includes('max_tokens') || errorMsgStr.includes('max_completion_tokens') || error.response?.status === 400) {
                try {
                    const retryResponse = await axios.post(url, {
                        model: modelId,
                        messages: [{ role: 'user', content: 'Hi' }]
                    }, {
                        headers: this._getHeaders(),
                        timeout: 12000
                    });

                    const latency = Date.now() - startTime;
                    const status = '🟢 HEALTHY';
                    
                    db.run(`UPDATE models SET status = ?, latency = ?, last_tested = CURRENT_TIMESTAMP, score = score + 2 WHERE id = ?`, 
                        [status, latency, modelId]);
                        
                    return { status, latency, success: true, modelId };
                } catch (retryErr) {
                    // fall through to failure recording
                }
            }

            const latency = Date.now() - startTime;
            const status = error.response?.status === 429 ? '🟡 DEGRADED' : '🔴 FAILED';
            const cleanError = error.response ? `HTTP ${error.response.status}: ${errorMsgStr.substring(0, 100)}` : error.message;
            
            db.run(`UPDATE models SET status = ?, latency = ?, last_tested = CURRENT_TIMESTAMP, score = MAX(0, score - 3) WHERE id = ?`, 
                [status, latency, modelId]);
                
            return { status, latency, error: cleanError, success: false, modelId };
        }
    }

    async chatCompletion(modelId, requestBody) {
        const payload = { ...requestBody, model: modelId };
        try {
            const url = this.baseUrl.endsWith('/chat/completions') ? this.baseUrl : `${this.baseUrl}/chat/completions`;
            const response = await axios.post(url, payload, {
                headers: this._getHeaders(),
                timeout: 60000
            });
            
            db.run(`UPDATE models SET score = score + 1 WHERE id = ?`, [modelId]);
            return response.data;
        } catch (error) {
            db.run(`UPDATE models SET score = MAX(0, score - 5) WHERE id = ?`, [modelId]);
            if (error.response) {
                const detailedError = typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : error.response.data;
                throw new Error(`Provider Error (${error.response.status}): ${detailedError}`);
            }
            throw error;
        }
    }
}

module.exports = GenericProvider;
