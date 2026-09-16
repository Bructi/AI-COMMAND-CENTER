const db = require('../db/database');

class Router {
    constructor(providers) {
        this.providers = providers;
    }

    async resolveAlias(modelName) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT target_model_id, role, routing_mode FROM aliases WHERE alias = ?`, [modelName], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    }

    async findBestModel(role = null, mode = 'BALANCED', isFree = null) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT m.* FROM models m
                JOIN providers p ON m.provider_id = p.id
                WHERE p.enabled = 1 AND (m.status = '🟢 HEALTHY' OR m.status = '⚪ UNKNOWN')
            `;
            let params = [];

            if (role) {
                query += ` AND m.roles LIKE ?`;
                params.push(`%${role}%`);
            }

            if (isFree) {
                query += ` AND m.is_free = 1`;
            }

            // Order based on mode
            if (mode === 'FAST') {
                query += ` ORDER BY m.latency ASC NULLS LAST, m.score DESC`;
            } else if (mode === 'QUALITY') {
                query += ` ORDER BY m.score DESC, m.context_length DESC NULLS LAST`;
            } else { // BALANCED
                query += ` ORDER BY m.score DESC, m.latency ASC NULLS LAST`;
            }

            query += ` LIMIT 1`;

            db.get(query, params, (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    }

    async getModelById(modelId) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT m.* FROM models m JOIN providers p ON m.provider_id = p.id WHERE m.id = ? AND p.enabled = 1`, [modelId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    }

    async routeRequest(requestBody, modelName) {
        let targetModel = await this.getModelById(modelName);
        let mode = 'BALANCED';
        let isFree = modelName.includes('free');
        let role = null;

        // If not a direct model ID, check if it's an alias
        if (!targetModel) {
            const alias = await this.resolveAlias(modelName);
            if (alias) {
                if (alias.target_model_id) {
                    targetModel = await this.getModelById(alias.target_model_id);
                } else {
                    role = alias.role || null;
                    mode = alias.routing_mode || 'BALANCED';
                    targetModel = await this.findBestModel(role, mode, isFree);
                }
            } else {
                // Try to parse implicit aliases like omni-fast, omni-code
                if (modelName.includes('fast')) mode = 'FAST';
                if (modelName.includes('code')) role = 'CODING';
                if (modelName.includes('reason')) role = 'REASONING';
                
                // If it looks like an alias but not registered, try to find a match dynamically
                if (modelName.startsWith('omni-') || mode !== 'BALANCED' || role) {
                     targetModel = await this.findBestModel(role, mode, isFree);
                }
            }
        }

        if (!targetModel) {
            throw new Error(`Could not find a suitable model for request: ${modelName}`);
        }

        // Fallback chain logic
        const maxRetries = 3;
        let attempts = 0;
        let currentModel = targetModel;
        let lastError = null;
        let triedModelIds = new Set();

        while (attempts < maxRetries && currentModel) {
            attempts++;
            triedModelIds.add(currentModel.id);
            
            const provider = this.providers[currentModel.provider_id];
            if (!provider) {
                lastError = new Error(`Provider ${currentModel.provider_id} is not configured.`);
                currentModel = await this._getNextFallback(role, mode, isFree, triedModelIds);
                continue;
            }

            try {
                console.log(`[Router] Routing to ${currentModel.id} (Attempt ${attempts})`);
                const startTime = Date.now();
                const response = await provider.chatCompletion(currentModel.id, requestBody);
                const latency = Date.now() - startTime;
                
                db.run(`INSERT INTO logs (requested_model, routed_model, latency, status) VALUES (?, ?, ?, ?)`, 
                    [modelName, currentModel.id, latency, 'SUCCESS']);
                    
                return response;
            } catch (error) {
                console.warn(`[Router] Attempt ${attempts} failed with model ${currentModel.id}: ${error.message}`);
                
                db.run(`INSERT INTO logs (requested_model, routed_model, status, error_message) VALUES (?, ?, ?, ?)`, 
                    [modelName, currentModel.id, 'FAILED', error.message]);
                    
                lastError = error;
                // Find next best model that hasn't been tried
                currentModel = await this._getNextFallback(role, mode, isFree, triedModelIds);
            }
        }

        db.run(`INSERT INTO logs (requested_model, status, error_message) VALUES (?, ?, ?)`, 
            [modelName, 'FATAL', `Failed after ${attempts} attempts.`]);
            
        throw new Error(`Routing failed after ${attempts} attempts. Last error: ${lastError?.message}`);
    }

    async simulateRoute(modelName) {
        let targetModel = await this.getModelById(modelName);
        let mode = 'BALANCED';
        let isFree = modelName.includes('free');
        let role = null;
        let aliasInfo = null;

        if (!targetModel) {
            aliasInfo = await this.resolveAlias(modelName);
            if (aliasInfo) {
                if (aliasInfo.target_model_id) {
                    targetModel = await this.getModelById(aliasInfo.target_model_id);
                } else {
                    role = aliasInfo.role || null;
                    mode = aliasInfo.routing_mode || 'BALANCED';
                    targetModel = await this.findBestModel(role, mode, isFree);
                }
            } else {
                if (modelName.includes('fast')) mode = 'FAST';
                if (modelName.includes('code')) role = 'CODING';
                if (modelName.includes('reason')) role = 'REASONING';
                if (modelName.includes('vision')) role = 'VISION';
                if (modelName.includes('agent')) role = 'AGENT';
                targetModel = await this.findBestModel(role, mode, isFree);
            }
        }

        // Get prospective fallback chain
        const fallbacks = [];
        const tried = new Set();
        if (targetModel) tried.add(targetModel.id);

        for (let i = 0; i < 3; i++) {
            const nextFallback = await this._getNextFallback(role, mode, isFree, tried);
            if (nextFallback) {
                tried.add(nextFallback.id);
                fallbacks.push(nextFallback);
            }
        }

        return {
            requested: modelName,
            resolvedModel: targetModel,
            mode,
            role,
            isFree,
            alias: aliasInfo,
            providerConfigured: targetModel ? !!this.providers[targetModel.provider_id] : false,
            fallbackChain: fallbacks
        };
    }

    async _getNextFallback(role, mode, isFree, triedModelIds) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT m.* FROM models m
                JOIN providers p ON m.provider_id = p.id
                WHERE p.enabled = 1 AND (m.status = '🟢 HEALTHY' OR m.status = '⚪ UNKNOWN')
            `;
            let params = [];

            if (triedModelIds.size > 0) {
                const placeholders = Array.from(triedModelIds).map(() => '?').join(',');
                query += ` AND m.id NOT IN (${placeholders})`;
                params.push(...Array.from(triedModelIds));
            }

            if (role) {
                query += ` AND m.roles LIKE ?`;
                params.push(`%${role}%`);
            }

            if (isFree) {
                query += ` AND m.is_free = 1`;
            }

            if (mode === 'FAST') {
                query += ` ORDER BY m.latency ASC NULLS LAST, m.score DESC`;
            } else if (mode === 'QUALITY') {
                query += ` ORDER BY m.score DESC, m.context_length DESC NULLS LAST`;
            } else {
                query += ` ORDER BY m.score DESC, m.latency ASC NULLS LAST`;
            }

            query += ` LIMIT 1`;

            db.get(query, params, (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    }
}

module.exports = Router;
