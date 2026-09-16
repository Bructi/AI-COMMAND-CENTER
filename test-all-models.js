require('dotenv').config();
const db = require('./src/db/database');
const GenericProvider = require('./src/providers/GenericProvider');

async function testAllModels() {
    console.log('\n======================================================');
    console.log('⚡ STARTING COMPREHENSIVE MULTI-MODEL HEALTH TEST');
    console.log('======================================================\n');

    db.all(`SELECT m.id, m.provider_id, p.base_url, p.api_key, p.name as provider_name 
            FROM models m 
            JOIN providers p ON m.provider_id = p.id 
            WHERE p.enabled = 1`, [], async (err, models) => {
        if (err) {
            console.error('Database query error:', err.message);
            process.exit(1);
        }

        if (!models || models.length === 0) {
            console.log('No models found from active providers to test.');
            process.exit(0);
        }

        console.log(`Found ${models.length} models across enabled providers to test.\n`);

        const providersCache = {};
        for (const m of models) {
            if (!providersCache[m.provider_id]) {
                const key = m.api_key || process.env[`${m.provider_id.toUpperCase()}_API_KEY`] || '';
                providersCache[m.provider_id] = new GenericProvider(m.provider_id, m.provider_name, m.base_url, key);
            }
        }

        const stats = {
            total: models.length,
            tested: 0,
            healthy: 0,
            degraded: 0,
            failed: 0,
            healthyModels: []
        };

        const concurrency = 15;
        let cursor = 0;

        const worker = async (workerId) => {
            while (cursor < models.length) {
                const idx = cursor++;
                const item = models[idx];
                if (!item) break;

                const provider = providersCache[item.provider_id];
                try {
                    const res = await provider.healthCheck(item.id);
                    stats.tested++;

                    if (res.status.includes('HEALTHY')) {
                        stats.healthy++;
                        stats.healthyModels.push({ id: item.id, latency: res.latency, provider: item.provider_id });
                        console.log(`[${stats.tested}/${stats.total}] 🟢 HEALTHY (${res.latency}ms): ${item.id}`);
                    } else if (res.status.includes('DEGRADED')) {
                        stats.degraded++;
                        console.log(`[${stats.tested}/${stats.total}] 🟡 DEGRADED: ${item.id} (${res.error || 'Rate limit'})`);
                    } else {
                        stats.failed++;
                        console.log(`[${stats.tested}/${stats.total}] 🔴 FAILED: ${item.id} (${(res.error || 'Unavailable').substring(0, 60)})`);
                    }
                } catch (e) {
                    stats.tested++;
                    stats.failed++;
                    console.log(`[${stats.tested}/${stats.total}] 🔴 ERROR: ${item.id} (${e.message.substring(0, 60)})`);
                }
            }
        };

        const pool = [];
        for (let i = 0; i < concurrency; i++) {
            pool.push(worker(i));
        }

        await Promise.all(pool);

        console.log('\n======================================================');
        console.log(`📊 FINAL HEALTH AUDIT SUMMARY:`);
        console.log(`Total Models Tested: ${stats.tested} / ${stats.total}`);
        console.log(`🟢 HEALTHY Models:   ${stats.healthy}`);
        console.log(`🟡 DEGRADED Models:  ${stats.degraded}`);
        console.log(`🔴 FAILED Models:    ${stats.failed}`);
        console.log('======================================================\n');

        if (stats.healthyModels.length > 0) {
            console.log('🌟 VERIFIED WORKING & OPERATIONAL MODELS:');
            stats.healthyModels.sort((a, b) => a.latency - b.latency);
            stats.healthyModels.forEach((m, i) => {
                console.log(`${(i + 1).toString().padStart(3)}. ${m.id.padEnd(50)} | ${m.latency}ms | Provider: ${m.provider}`);
            });
        }

        process.exit(0);
    });
}

testAllModels();
