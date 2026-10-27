module.exports = { '/api/agent': { target: process.env.AGENT_PROXY_URL || 'http://127.0.0.1:4300' } };
