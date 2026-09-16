const axios = require('axios');
require('dotenv').config();

async function testRouter() {
    console.log("Sending test request to AI Command Center...");
    try {
        const response = await axios.post('http://localhost:3000/v1/chat/completions', {
            model: "omni-fast",
            messages: [{ role: "user", content: "Say hello!" }]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.COMMAND_CENTER_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log("✅ Success! Router responded with:");
        console.log(response.data.choices[0].message.content);
        console.log("\n➡️ Now check your Dashboard in the browser!");
        
    } catch (error) {
        console.error("❌ Error:", error.response ? error.response.data : error.message);
    }
}

testRouter();
