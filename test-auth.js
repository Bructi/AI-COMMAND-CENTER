const authManager = require('./src/auth/AuthManager');
const db = require('./src/db/database');

async function testAuth() {
    console.log("=== Testing Authentication & Google Drive Integration ===");

    // Wait 500ms for db table initialization
    await new Promise(r => setTimeout(r, 500));

    const testUsername = 'testpilot_' + Date.now();
    const testEmail = `pilot_${Date.now()}@example.com`;
    const testPassword = 'SecurePassword123!';
    const testName = 'Test Pilot';

    console.log(`1. Testing Registration for ${testUsername}...`);
    const regResult = await authManager.register({
        username: testUsername,
        email: testEmail,
        password: testPassword,
        name: testName
    });

    console.log("-> Registered User:", regResult.user.username, "| Role:", regResult.user.role, "| API Key:", regResult.user.api_key);
    console.log("-> Session Token Generated:", regResult.token.substring(0, 16) + '...');

    console.log("\n2. Testing Session Validation...");
    const validatedUser = await authManager.validateSession(regResult.token);
    if (!validatedUser || validatedUser.username !== testUsername) {
        throw new Error("Session validation failed!");
    }
    console.log("-> Session successfully validated for:", validatedUser.username);

    console.log("\n3. Testing Login...");
    const loginResult = await authManager.login({
        login: testEmail,
        password: testPassword
    });
    console.log("-> Logged in successfully! Token:", loginResult.token.substring(0, 16) + '...');

    console.log("\n4. Testing API Key Lookup...");
    const apiKeyUser = await authManager.getUserByApiKey(regResult.user.api_key);
    if (!apiKeyUser || apiKeyUser.id !== regResult.user.id) {
        throw new Error("API Key lookup failed!");
    }
    console.log("-> API Key correctly mapped to:", apiKeyUser.username);

    console.log("\n5. Testing API Key Regeneration...");
    const newApiKey = await authManager.regenerateApiKey(regResult.user.id);
    console.log("-> New API Key:", newApiKey);

    console.log("\n6. Testing Google OAuth Unified Account Handler...");
    const googleProfile = {
        googleId: 'g_test_' + Date.now(),
        email: `google_${Date.now()}@gmail.com`,
        name: 'Google Test User',
        picture: 'https://lh3.googleusercontent.com/a/default-user',
        tokens: { access_token: 'mock_token_123', refresh_token: 'mock_refresh_456' }
    };
    const googleResult = await authManager.handleGoogleAuth(googleProfile);
    console.log("-> Google Auth Created User:", googleResult.user.username, "| Google Connected:", googleResult.user.google_connected);

    console.log("\n7. Testing Logout...");
    await authManager.logout(loginResult.token);
    const postLogout = await authManager.validateSession(loginResult.token);
    if (postLogout) {
        throw new Error("Session was not destroyed on logout!");
    }
    console.log("-> Session destroyed successfully!");

    console.log("\n✅ ALL AUTHENTICATION TESTS PASSED!");
    process.exit(0);
}

testAuth().catch(err => {
    console.error("❌ Auth test error:", err);
    process.exit(1);
});
