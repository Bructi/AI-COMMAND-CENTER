const axios = require('axios');
const BaseProvider = require('./BaseProvider');
const db = require('../db/database.js');

class OpenRouterProvider extends BaseProvider {
    constructor() {
        super('OpenRouter', 'https://openrouter.ai/api/v1', process.env.OPENROUTER_API_KEY);
    }

    async discoverModels() {
        // ... (Keep your existing discoverModels code here) ...
        try {
            const response = await axios.get(`${this.baseUrl}/models`);
            const models = response.data.data;
            
            models.forEach(model => {
                const isFree = model.pricing.prompt === "0" && model.pricing.completion === "0";
                const contextLength = model.context_length || 0;
                
                // Assign basic roles based on model ID
                const roles = [];
                if (model.id.toLowerCase().includes('vision')) roles.push('VISION');
                if (model.id.toLowerCase().includes('coder') || model.id.toLowerCase().includes('code')) roles.push('CODING');
                if (model.id.toLowerCase().includes('math') || model.id.toLowerCase().includes('reason')) roles.push('REASONING');
                const rolesStr = roles.join(',');
                
                db.run(
                    `INSERT INTO models (id, provider_id, is_free, context_length, roles) 
                     VALUES (?, ?, ?, ?, ?) 
                     ON CONFLICT(id) DO UPDATE SET is_free = ?, context_length = ?, roles = ?`,
                    [model.id, 'openrouter', isFree, contextLength, rolesStr, isFree, contextLength, rolesStr]
                );
            });
            
            return { success: true, count: models.length };
        } catch (error) {
            console.error(`[${this.name}] Discovery failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async healthCheck(modelId) {
        const startTime = Date.now();
        try {
            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: modelId,
                messages: [{ role: 'user', content: 'Reply with only the word "OK".' }],
                max_tokens: 5
            }, {
                headers: { 
                    'Authorization': `Bearer ${this.apiKey}`,
                    'HTTP-Referer': 'http://localhost:3000', // Required by OpenRouter
                    'X-Title': 'AI Command Center'
                }
            });

            const latency = Date.now() - startTime;
            const status = '🟢 HEALTHY';
            
            db.run(`UPDATE models SET status = ?, latency = ?, last_tested = CURRENT_TIMESTAMP WHERE id = ?`, 
                [status, latency, modelId]);
                
            return { status, latency };

        } catch (error) {
            const latency = Date.now() - startTime;
            // Handle HTTP 429 Rate Limits separately from hard failures
            const status = error.response?.status === 429 ? '🟡 DEGRADED' : '🔴 FAILED';
            
            db.run(`UPDATE models SET status = ?, latency = ?, last_tested = CURRENT_TIMESTAMP WHERE id = ?`, 
                [status, latency, modelId]);
                
            return { status, latency, error: error.message };
        }
    }

    async chatCompletion(modelId, requestBody) {
        // Build the payload
        const payload = {
            ...requestBody,
            model: modelId
        };
        
        try {
            const response = await axios.post(`${this.baseUrl}/chat/completions`, payload, {
                headers: { 
                    'Authorization': `Bearer ${this.apiKey}`,
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-Title': 'AI Command Center',
                    'Content-Type': 'application/json'
                }
            });
            
            // Record successful usage (could be extracted to a logging/scoring service)
            db.run(`UPDATE models SET score = score + 1 WHERE id = ?`, [modelId]);
            
            return response.data;
        } catch (error) {
            // Lower score on failure
            db.run(`UPDATE models SET score = MAX(0, score - 5) WHERE id = ?`, [modelId]);
            
            if (error.response) {
                // Return the provider's error nicely formatted
                throw new Error(`Provider Error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }
}

module.exports = OpenRouterProvider;