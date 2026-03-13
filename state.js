// Shared mutable state used across modules
module.exports = {
    connectedClients: 0,
    lastActivity: new Date(),
    dbStats: {
        connectionStatus: 'disconnected',
        lastQuery: null,
        queriesPerMinute: 0,
        averageResponseTime: 0
    },
    apiCallStats: {
        totalCalls: 0,
        callsPerMinute: 0,
        recentCalls: []
    }
};
